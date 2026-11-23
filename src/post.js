import * as THREE from 'three';
import { SENSOR_HEIGHT } from './lens.js';

// 後期管線（自己寫的小型合成器，不依賴 EffectComposer）：
//   場景 → 線性 HDR render target（含深度）
//   → 景深：半解析度算模糊圈（CoC）並做圓形光圈收集
//   → lens glow：1/4 解析度抽高光後三層擴散
//   → 體積光柱：沿視線查太陽陰影貼圖，算出被樹冠遮擋的散射光（1/4 解析度；high 32 步、mid 14 步）
//   → 合成 + 對比調色 + 暗角 + tone mapping（ACES Filmic，全程只做這一次）+ sRGB 輸出
// 主畫面解析度固定跟著 renderer 的 drawing buffer；效能不夠時先降輔助 pass（auxScale）。

/** 前景層用的 layer：主畫面的鏡頭只看 layer 0 */
export const FOREGROUND_LAYER = 1;

const FULLSCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const DEPTH_GLSL = /* glsl */ `
  uniform sampler2D tDepth;
  uniform float uNear;
  uniform float uFar;
  uniform float uFocus;      // 對焦距離（公尺）
  uniform float uFocal;      // 焦距（公尺）
  uniform float uCocScale;   // f² / N × 0.5 × 畫面高度(px) / 片門高度
  uniform float uMaxCoc;     // 模糊圈半徑上限（全解析度像素）
  float linearDepth(vec2 uv) {
    float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
    return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
  }
  // 薄透鏡：帶正負號的模糊圈半徑，正規化到 -1（近）..1（遠）
  float signedCoc(float depth) {
    float radius = uCocScale / max(uFocus - uFocal, 0.001) * (1.0 - uFocus / max(depth, 0.001));
    return clamp(radius / uMaxCoc, -1.0, 1.0);
  }
`;

// 半解析度：顏色 + 這一格裡最近表面的 CoC（銳利的前景邊緣不會被後面的模糊吃掉）
const COC_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform vec2 uTexel; // 全解析度的 1 / size
  ${DEPTH_GLSL}
  void main() {
    float depth = min(
      min(linearDepth(vUv + uTexel * vec2(-0.5, -0.5)), linearDepth(vUv + uTexel * vec2(0.5, -0.5))),
      min(linearDepth(vUv + uTexel * vec2(-0.5, 0.5)), linearDepth(vUv + uTexel * vec2(0.5, 0.5)))
    );
    // 壓住極亮的像素（太陽），避免景深把它抹成一大片
    vec3 color = min(texture2D(tColor, vUv).rgb, vec3(6.0));
    gl_FragColor = vec4(color, signedCoc(depth));
  }
`;

// 圓形光圈收集（golden-angle 螺旋）。較遠的取樣不會滲進比它銳利的前景；
// 前景的模糊則可以越過自己的輪廓往外擴，alpha 記下「被前景模糊蓋到多少」。
const BOKEH_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tCoc;
  uniform vec2 uTexel;    // 這個 buffer 的 1 / size
  uniform float uRadius;  // 這個 buffer 裡的最大半徑（像素）
  const float GOLDEN_ANGLE = 2.39996323;
  const float RADIUS_STEP = 0.75;
  void main() {
    vec4 center = texture2D(tCoc, vUv);
    float centerSize = abs(center.a) * uRadius;
    vec3 color = center.rgb;
    float total = 1.0;
    float near = center.a < 0.0 ? -center.a : 0.0;
    float radius = RADIUS_STEP;
    for (float angle = 0.0; radius < uRadius; angle += GOLDEN_ANGLE) {
      vec4 tap = texture2D(tCoc, vUv + vec2(cos(angle), sin(angle)) * uTexel * radius);
      float tapSize = abs(tap.a) * uRadius;
      if (tap.a > center.a) tapSize = clamp(tapSize, 0.0, centerSize * 2.0);
      float weight = smoothstep(radius - 0.5, radius + 0.5, tapSize);
      color += mix(color / total, tap.rgb, weight);
      near += tap.a < 0.0 ? weight * -tap.a : 0.0;
      total += 1.0;
      radius += RADIUS_STEP / radius;
    }
    gl_FragColor = vec4(color / total, clamp(near / total * 2.5, 0.0, 1.0));
  }
`;

// 抽高光：只留超過門檻的部分（太陽、太陽周圍的天空、許願葉的描邊），一般葉子不會進來
const BRIGHT_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform vec2 uTexel; // 全解析度的 1 / size
  uniform float uThreshold;
  void main() {
    vec3 color =
      texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb +
      texture2D(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb +
      texture2D(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb +
      texture2D(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb;
    color *= 0.25;
    float peak = max(color.r, max(color.g, color.b));
    color *= max(peak - uThreshold, 0.0) / max(peak, 0.0001);
    gl_FragColor = vec4(min(color, vec3(24.0)), 1.0);
  }
`;

// 9-tap 高斯（利用線性取樣合併成 5 次取樣）；alpha 一起模糊（景深的前景覆蓋量也要柔化）
const BLUR_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform vec2 uStep;
  void main() {
    vec4 color = texture2D(tColor, vUv) * 0.227027;
    color += (texture2D(tColor, vUv + uStep * 1.384615) + texture2D(tColor, vUv - uStep * 1.384615)) * 0.316216;
    color += (texture2D(tColor, vUv + uStep * 3.230769) + texture2D(tColor, vUv - uStep * 3.230769)) * 0.070270;
    gl_FragColor = color;
  }
`;

// 體積光柱：每個像素沿視線在空氣裡走幾步，每一步查太陽的陰影貼圖——
// 被樹冠擋住的地方沒有散射光，葉縫裡透出來的光就變成一條條真正被遮擋的光柱。
// 散射用 Henyey–Greenstein 前向相位：朝太陽方向看（逆光）時最亮。
// 低解析度計算、固定的抖動，接著做深度感知的模糊把抖動抹平。
const VOLUME_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tDepth;
  uniform sampler2DShadow tShadow;
  uniform mat4 uShadowMatrix;
  uniform mat4 uInverseProjection;
  uniform mat4 uCameraWorld;
  uniform vec3 uCameraPosition;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uNear;
  uniform float uFar;
  uniform float uMaxDistance;
  uniform float uShadowReady;
  uniform float uIntensity;
  float interleavedNoise( vec2 p ) {
    return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
  }
  float beamHash( vec2 p ) {
    p = fract( p * vec2( 123.34, 456.21 ) );
    p += dot( p, p + 45.32 );
    return fract( p.x * p.y );
  }
  float beamNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 u = fract( p );
    u = u * u * ( 3.0 - 2.0 * u );
    return mix( mix( beamHash( i ), beamHash( i + vec2( 1.0, 0.0 ) ), u.x ),
                mix( beamHash( i + vec2( 0.0, 1.0 ) ), beamHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
  }
  // 沿太陽方向不變的圖樣：把點沿光線投到樹冠高度的平面上取雜訊。
  // 同一條光線上的值都一樣，所以亮暗會沿著光的方向拉成一條條光束（像光穿過遠處的葉縫）
  float beamPattern( vec3 p, float t ) {
    vec2 q = p.xz + uSunDir.xz * ( ( 6.0 - p.y ) / uSunDir.y );
    float n = beamNoise( q * 0.55 ) * 0.65 + beamNoise( q * 1.4 + 3.1 ) * 0.35;
    // 只在樹冠高度以下拉成光束；樹梢以上的開闊天空不做條紋（低角度的太陽會把它拉成橫紋）
    // 遠處（> 15 m）的條紋淡掉：低角度看出去會疊成橫向的色帶
    float fade = max( smoothstep( 4.5, 8.0, p.y ), smoothstep( 15.0, 38.0, t ) );
    return mix( 0.08 + 2.0 * smoothstep( 0.45, 0.76, n ), 0.6, fade );
  }
  void main() {
    float z = texture2D( tDepth, vUv ).x;
    vec4 view = uInverseProjection * vec4( vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0 );
    view /= view.w;
    vec3 world = ( uCameraWorld * vec4( view.xyz, 1.0 ) ).xyz;
    vec3 ray = world - uCameraPosition;
    float distance = length( ray );
    vec3 dir = ray / max( distance, 1e-4 );
    float tMax = min( distance, uMaxDistance );
    float stepLength = tMax / float( STEPS );
    float offset = interleavedNoise( gl_FragCoord.xy );
    float lit = 0.0;
    for ( int i = 0; i < STEPS; i++ ) {
      float t = ( float( i ) + offset ) * stepLength;
      vec3 p = uCameraPosition + dir * t;
      vec4 s = uShadowMatrix * vec4( p, 1.0 );
      float visible = 1.0;
      if ( uShadowReady > 0.5 && all( greaterThan( s.xyz, vec3( 0.0 ) ) ) && all( lessThan( s.xyz, vec3( 1.0 ) ) ) ) {
        visible = texture( tShadow, vec3( s.xy, s.z - 0.0015 ) );
      }
      // 低處空氣較濃（地面的薄霧），往上變稀
      float density = exp( - 0.22 * max( p.y, 0.0 ) ) * beamPattern( p, t );
      lit += visible * density * exp( - 0.018 * t );
    }
    float mu = dot( dir, uSunDir );
    const float g = 0.68;
    float hg = ( 1.0 - g * g ) / pow( 1.0 + g * g - 2.0 * g * mu, 1.5 );
    float phase = ( 0.06 + hg * 0.1 ) * uIntensity;
    float linear = 2.0 * uNear * uFar / ( uFar + uNear - ( z * 2.0 - 1.0 ) * ( uFar - uNear ) );
    gl_FragColor = vec4( uSunColor * lit * stepLength * phase, linear );
  }
`;

// 深度感知的可分離模糊（光柱專用）：alpha 存線性深度，深度差太多的取樣權重趨近 0，
// 樹幹前後的光不會互相滲過去
const VOLUME_BLUR_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tVolume;
  uniform vec2 uStep;
  void main() {
    vec4 center = texture2D( tVolume, vUv );
    vec3 sum = center.rgb;
    float total = 1.0;
    for ( int i = 1; i <= 4; i++ ) {
      float w = exp( - float( i * i ) / 8.0 );
      for ( int side = -1; side <= 1; side += 2 ) {
        vec4 tap = texture2D( tVolume, vUv + uStep * float( i * side ) );
        float depthWeight = 1.0 / ( 1.0 + abs( tap.a - center.a ) / max( center.a, 0.1 ) * 12.0 );
        sum += tap.rgb * w * depthWeight;
        total += w * depthWeight;
      }
    }
    gl_FragColor = vec4( sum / total, center.a );
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform sampler2D tDof;
  uniform sampler2D tGlow0;
  uniform sampler2D tGlow1;
  uniform sampler2D tGlow2;
  uniform sampler2D tRays;
  uniform vec2 uRaysTexel;
  uniform sampler2D tForeground;
  uniform float uForeground;
  uniform float uGlow;
  uniform float uRays;
  uniform float uVignette;
  uniform float uAspect;
  uniform float uContrast;
  ${DEPTH_GLSL}
  void main() {
    // 壓住極少數過亮的像素（太陽邊緣的葉緣），避免閃爍的白點
    vec3 color = min(texture2D(tColor, vUv).rgb, vec3(40.0));

    #if defined(USE_DOF) || defined(USE_RAYS)
      float depth = linearDepth(vUv);
    #endif

    #ifdef USE_DOF
      vec4 dof = texture2D(tDof, vUv);
      // 模糊圈小於約 1 px 的地方完全保留原解析度（許願葉所在的深度）
      float blend = max(smoothstep(0.07, 0.42, abs(signedCoc(depth))), dof.a);
      color = mix(color, dof.rgb, blend);
    #endif

    #ifdef USE_GLOW
      color += (texture2D(tGlow0, vUv).rgb * 0.5 + texture2D(tGlow1, vUv).rgb * 0.32 + texture2D(tGlow2, vUv).rgb * 0.18) * uGlow;
    #endif

    #ifdef USE_RAYS
      // 體積光柱已經只積分到表面為止，直接疊加。
      // 1/4 解析度的結果用深度感知的 4-tap 放大（alpha 存線性深度），樹幹邊緣不會出現方塊
      {
        vec2 raysPos = vUv / uRaysTexel - 0.5;
        vec2 base = floor(raysPos);
        vec2 f = raysPos - base;
        vec3 sum = vec3(0.0);
        float total = 0.0;
        for (int k = 0; k < 4; k++) {
          vec2 o = vec2(float(k - (k / 2) * 2), float(k / 2));
          vec4 tap = texture2D(tRays, (base + o + 0.5) * uRaysTexel);
          float bilinear = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y);
          float w = (bilinear + 0.02) / (0.02 + abs(tap.a - depth) / max(depth, 0.1));
          sum += tap.rgb * w;
          total += w;
        }
        color += sum / max(total, 1e-4) * uRays;
      }
    #endif

    // 前景層（已預先模糊、預乘 alpha 的樹枝剪影），疊在最上面
    if (uForeground > 0.5) {
      vec4 fg = texture2D(tForeground, vUv);
      // 模糊會把細枝的覆蓋率攤薄成半透明；提高一點覆蓋率，剪影才有分量
      float fgAlpha = min(fg.a * 1.6, 1.0);
      color = color * (1.0 - fgAlpha) + fg.rgb * (fgAlpha / max(fg.a, 1e-4));
    }

    // 調色：以 18% 灰為中心拉開對比（暗部更深、亮部更透），再讓暗部略偏冷、亮部偏暖
    float lum = max(dot(color, vec3(0.2126, 0.7152, 0.0722)), 1e-5);
    float graded = 0.18 * pow(lum / 0.18, uContrast);
    color *= graded / lum;
    float shadowMix = 1.0 - smoothstep(0.0, 0.12, graded);
    color *= mix(vec3(1.0), vec3(0.9, 0.95, 1.08), shadowMix * 0.5);

    vec2 fromCenter = (vUv - 0.5) * vec2(min(uAspect, 1.6) / 1.6 + 0.35, 1.0);
    color *= 1.0 - uVignette * smoothstep(0.32, 0.95, length(fromCenter) * 1.35);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // 極輕微的抖動，消除天空漸層的色階
    gl_FragColor.rgb += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
  }
`;

function createTarget(options = {}) {
  return new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    ...options,
  });
}

const pass = (fragmentShader, uniforms, extra = {}) =>
  new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    ...extra,
  });

/**
 * 建立後期管線。float render target 不支援時 supported 為 false，
 * render() 會退回直接畫到螢幕（仍有 renderer 的 tone mapping）。
 */
export function createPost(renderer, { sunDirection }) {
  const supported =
    renderer.capabilities.isWebGL2 !== false &&
    (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));

  /** rays：'full'（high）、'lite'（mid 的簡化版）或 false */
  const settings = { dof: true, glow: true, rays: 'full', msaa: 4, auxScale: 1 };
  const look = { glow: 0.2, rays: 1, vignette: 0.42, threshold: 1.8, fStop: 1.4, maxCoc: 0.009, contrast: 1.18 };
  /** 太陽的平行光（陰影貼圖給體積光柱用），由 setSun() 指定 */
  let sunLight = null;
  const size = new THREE.Vector2(1, 1);

  const sceneTarget = createTarget({ depthBuffer: true, samples: settings.msaa });
  sceneTarget.depthTexture = new THREE.DepthTexture(1, 1);
  sceneTarget.depthTexture.minFilter = sceneTarget.depthTexture.magFilter = THREE.NearestFilter;

  const cocTarget = createTarget();
  const dofTarget = createTarget();
  // lens glow 的三層：1/4、1/8、1/16，各有一張暫存
  const glow = [0, 1, 2].map(() => ({ a: createTarget(), b: createTarget() }));
  // 光柱：raysTemp 放原始結果，raysTarget 放橫向模糊，縱向模糊再寫回 raysTemp 給合成用
  const raysTarget = createTarget();
  const raysTemp = createTarget();
  // 前景層：鏡頭前很近的物件（前景樹枝）單獨畫在 1/4 解析度、透明底的 buffer，再用高斯模糊成柔和的剪影。
  // 這種距離的模糊圈遠超過景深 pass 的上限，直接交給景深會有階梯狀的邊緣。
  const foregroundTarget = createTarget();
  const foregroundTemp = createTarget();
  const allTargets = [sceneTarget, cocTarget, dofTarget, raysTarget, raysTemp, foregroundTarget, foregroundTemp, ...glow.flatMap((g) => [g.a, g.b])];

  const depthUniforms = {
    tDepth: { value: sceneTarget.depthTexture },
    uNear: { value: 0.1 },
    uFar: { value: 400 },
    uFocus: { value: 11 },
    uFocal: { value: 0.035 },
    uCocScale: { value: 0 },
    uMaxCoc: { value: 8 },
  };
  const fullTexel = { value: new THREE.Vector2() };

  const cocMaterial = pass(COC_FRAGMENT, { tColor: { value: sceneTarget.texture }, uTexel: fullTexel, ...depthUniforms });
  const bokehMaterial = pass(BOKEH_FRAGMENT, {
    tCoc: { value: cocTarget.texture },
    uTexel: { value: new THREE.Vector2() },
    uRadius: { value: 4 },
  });
  const brightMaterial = pass(BRIGHT_FRAGMENT, {
    tColor: { value: sceneTarget.texture },
    uTexel: fullTexel,
    uThreshold: { value: look.threshold },
  });
  const blurMaterial = pass(BLUR_FRAGMENT, { tColor: { value: null }, uStep: { value: new THREE.Vector2() } });
  const volumeUniforms = {
    tDepth: { value: sceneTarget.depthTexture },
    tShadow: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uInverseProjection: { value: new THREE.Matrix4() },
    uCameraWorld: { value: new THREE.Matrix4() },
    uCameraPosition: { value: new THREE.Vector3() },
    uSunDir: { value: sunDirection.clone() },
    uSunColor: { value: new THREE.Color(1.0, 0.62, 0.32) },
    uNear: depthUniforms.uNear,
    uFar: depthUniforms.uFar,
    uMaxDistance: { value: 48 },
    uShadowReady: { value: 0 },
    uIntensity: { value: 0.075 },
  };
  // 兩種份量（都在 1/4 解析度：光柱是低頻的，深度感知模糊補回邊緣）：high 32 步，mid 14 步
  const volumeMaterials = {
    full: pass(VOLUME_FRAGMENT, volumeUniforms, { defines: { STEPS: 32 } }),
    lite: pass(VOLUME_FRAGMENT, volumeUniforms, { defines: { STEPS: 14 } }),
  };
  const volumeBlurMaterial = pass(VOLUME_BLUR_FRAGMENT, { tVolume: { value: null }, uStep: { value: new THREE.Vector2() } });
  const compositeMaterial = pass(
    COMPOSITE_FRAGMENT,
    {
      tColor: { value: sceneTarget.texture },
      tDof: { value: dofTarget.texture },
      tGlow0: { value: glow[0].a.texture },
      tGlow1: { value: glow[1].a.texture },
      tGlow2: { value: glow[2].a.texture },
      // 模糊後的光柱最後落在 raysTemp（見 renderVolume）
      tRays: { value: raysTemp.texture },
      uRaysTexel: { value: new THREE.Vector2(1, 1) },
      tForeground: { value: null },
      uForeground: { value: 0 },
      uGlow: { value: look.glow },
      uRays: { value: look.rays },
      uVignette: { value: look.vignette },
      uAspect: { value: 1 },
      uContrast: { value: look.contrast },
      ...depthUniforms,
    },
    { defines: {} },
  );

  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  triangle.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(triangle, compositeMaterial);
  quad.frustumCulled = false;
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function draw(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quad, quadCamera);
  }

  function blur(source, target, x, y) {
    blurMaterial.uniforms.tColor.value = source.texture;
    blurMaterial.uniforms.uStep.value.set(x, y);
    draw(blurMaterial, target);
  }

  const even = (value) => Math.max(2, Math.round(value));

  function allocate() {
    const { x: width, y: height } = size;
    sceneTarget.setSize(width, height);
    fullTexel.value.set(1 / width, 1 / height);

    const aux = settings.auxScale;
    cocTarget.setSize(even((width / 2) * aux), even((height / 2) * aux));
    dofTarget.setSize(cocTarget.width, cocTarget.height);
    glow.forEach((level, i) => {
      const divisor = 4 * 2 ** i;
      const w = even((width / divisor) * aux);
      const h = even((height / divisor) * aux);
      level.a.setSize(w, h);
      level.b.setSize(w, h);
    });
    const raysDivisor = 4;
    raysTarget.setSize(even((width / raysDivisor) * aux), even((height / raysDivisor) * aux));
    raysTemp.setSize(raysTarget.width, raysTarget.height);
    compositeMaterial.uniforms.uRaysTexel.value.set(1 / raysTarget.width, 1 / raysTarget.height);
    foregroundTarget.setSize(even(width / 4), even(height / 4));
    foregroundTemp.setSize(foregroundTarget.width, foregroundTarget.height);

    bokehMaterial.uniforms.uTexel.value.set(1 / cocTarget.width, 1 / cocTarget.height);
    depthUniforms.uMaxCoc.value = Math.max(look.maxCoc * height, 2);
    bokehMaterial.uniforms.uRadius.value = depthUniforms.uMaxCoc.value * (cocTarget.height / height);
    compositeMaterial.uniforms.uAspect.value = width / height;
  }

  function syncDefines() {
    const defines = {};
    if (settings.dof) defines.USE_DOF = '';
    if (settings.glow) defines.USE_GLOW = '';
    if (settings.rays) defines.USE_RAYS = '';
    compositeMaterial.defines = defines;
    compositeMaterial.needsUpdate = true;
  }
  syncDefines();

  const forward = new THREE.Vector3();
  let foreground = null;
  const savedClear = new THREE.Color();

  /** 前景層：畫在透明底上，兩輪橫直高斯（每輪取樣間距放大）模糊成失焦的剪影 */
  function renderForeground(camera) {
    const layers = camera.layers.mask;
    camera.layers.set(FOREGROUND_LAYER);
    renderer.getClearColor(savedClear);
    const savedAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(foregroundTarget);
    renderer.clear();
    renderer.render(foreground, camera);
    renderer.setClearColor(savedClear, savedAlpha);
    camera.layers.mask = layers;
    const spread = Math.max(1, foregroundTarget.height / 450);
    for (const scale of [0.6, 0.85]) {
      blur(foregroundTarget, foregroundTemp, (scale * spread) / foregroundTarget.width, 0);
      blur(foregroundTemp, foregroundTarget, 0, (scale * spread) / foregroundTarget.height);
    }
  }

  /** 太陽在鏡頭後方時光柱幾乎看不到（前向散射），直接略過這個 pass */
  function sunFacing(camera) {
    camera.getWorldDirection(forward);
    return THREE.MathUtils.smoothstep(forward.dot(sunDirection), -0.35, 0.1);
  }

  function renderVolume(camera) {
    const map = sunLight?.shadow.map?.depthTexture ?? null;
    volumeUniforms.tShadow.value = map;
    volumeUniforms.uShadowReady.value = map ? 1 : 0;
    if (sunLight) volumeUniforms.uShadowMatrix.value.copy(sunLight.shadow.matrix);
    volumeUniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
    volumeUniforms.uCameraWorld.value.copy(camera.matrixWorld);
    volumeUniforms.uCameraPosition.value.setFromMatrixPosition(camera.matrixWorld);
    draw(volumeMaterials[settings.rays] ?? volumeMaterials.full, raysTemp);
    volumeBlurMaterial.uniforms.tVolume.value = raysTemp.texture;
    volumeBlurMaterial.uniforms.uStep.value.set(1 / raysTemp.width, 0);
    draw(volumeBlurMaterial, raysTarget);
    volumeBlurMaterial.uniforms.tVolume.value = raysTarget.texture;
    volumeBlurMaterial.uniforms.uStep.value.set(0, 1 / raysTarget.height);
    draw(volumeBlurMaterial, raysTemp);
  }

  return {
    supported,
    settings,
    look,

    /** 前景層物件（所有子物件要在 FOREGROUND_LAYER，主畫面不會畫到它） */
    setForeground(object) {
      foreground = object;
    },

    /** 體積光柱用的太陽（DirectionalLight，需開陰影） */
    setSun(light) {
      sunLight = light;
    },

    /** 切換效果與輔助 pass 的解析度比例（畫質分級用） */
    configure(next) {
      const before = { ...settings };
      Object.assign(settings, next);
      if (settings.msaa !== before.msaa) {
        sceneTarget.samples = settings.msaa;
        sceneTarget.dispose();
      }
      if (settings.auxScale !== before.auxScale || settings.rays !== before.rays) allocate();
      syncDefines();
    },

    /** 以 renderer 目前的 drawing buffer 大小（實體像素）重新配置所有 render target */
    resize() {
      renderer.getDrawingBufferSize(size);
      if (size.x < 1 || size.y < 1) return;
      allocate();
    },

    /**
     * 畫一幀。lens：{ focus（公尺）, focalLength（mm）}
     */
    render(scene, camera, lens) {
      if (!supported) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }

      renderer.setRenderTarget(sceneTarget);
      renderer.render(scene, camera);

      const focal = lens.focalLength * 0.001;
      depthUniforms.uNear.value = camera.near;
      depthUniforms.uFar.value = camera.far;
      depthUniforms.uFocus.value = lens.focus;
      depthUniforms.uFocal.value = focal;
      depthUniforms.uCocScale.value = ((focal * focal) / look.fStop) * 0.5 * (size.y / (SENSOR_HEIGHT * 0.001));

      if (settings.dof) {
        draw(cocMaterial, cocTarget);
        draw(bokehMaterial, dofTarget);
        // 光圈取樣數有限，大的模糊圈（前景樹枝）邊緣會有顆粒；半解析度再過一次小高斯抹平
        blur(dofTarget, cocTarget, 1 / dofTarget.width, 0);
        blur(cocTarget, dofTarget, 0, 1 / cocTarget.height);
      }

      const facing = settings.rays ? sunFacing(camera) : 0;
      const rays = facing > 0.01;
      if (settings.glow) {
        brightMaterial.uniforms.uThreshold.value = look.threshold;
        draw(brightMaterial, glow[0].a);
        glow.forEach((level, i) => {
          // 第一層在原尺寸做橫向；之後每層的橫向同時從上一層縮小取樣
          const source = i === 0 ? level.a : glow[i - 1].a;
          blur(source, level.b, 1 / source.width, 0);
          blur(level.b, level.a, 0, 1 / level.b.height);
        });
      }
      if (rays) renderVolume(camera);
      const showForeground = Boolean(foreground?.visible);
      if (showForeground) renderForeground(camera);
      compositeMaterial.uniforms.tForeground.value = foregroundTarget.texture;
      compositeMaterial.uniforms.uForeground.value = showForeground ? 1 : 0;

      compositeMaterial.uniforms.uGlow.value = settings.glow ? look.glow : 0;
      compositeMaterial.uniforms.uRays.value = rays ? look.rays * facing : 0;
      compositeMaterial.uniforms.uVignette.value = look.vignette;
      compositeMaterial.uniforms.uContrast.value = look.contrast;
      draw(compositeMaterial, null);
    },

    /** 實際的 buffer 尺寸，給報告與驗收用 */
    info() {
      return {
        supported,
        ...settings,
        scene: [sceneTarget.width, sceneTarget.height],
        dofSize: [dofTarget.width, dofTarget.height],
        glowSizes: glow.map((level) => [level.a.width, level.a.height]),
      };
    },

    dispose() {
      allTargets.forEach((target) => target.dispose());
    },
  };
}
