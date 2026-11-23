import * as THREE from 'three';
import { SENSOR_HEIGHT } from './lens.js';

// 後期管線（自己寫的小型合成器，不依賴 EffectComposer）：
//   場景 → 線性 HDR render target（含深度）
//   → 景深：半解析度算模糊圈（CoC）並做圓形光圈收集
//   → lens glow：1/4 解析度抽高光後三層擴散
//   → 光柱：把同一份高光朝太陽的畫面位置做放射狀累積（被樹冠遮住的地方自然沒有光）
//   → 合成 + 暗角 + tone mapping（ACES Filmic，全程只做這一次）+ sRGB 輸出
// 主畫面解析度固定跟著 renderer 的 drawing buffer；效能不夠時先降輔助 pass（auxScale）。

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

// 9-tap 高斯（利用線性取樣合併成 5 次取樣）
const BLUR_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform vec2 uStep;
  void main() {
    vec3 color = texture2D(tColor, vUv).rgb * 0.227027;
    color += (texture2D(tColor, vUv + uStep * 1.384615).rgb + texture2D(tColor, vUv - uStep * 1.384615).rgb) * 0.316216;
    color += (texture2D(tColor, vUv + uStep * 3.230769).rgb + texture2D(tColor, vUv - uStep * 3.230769).rgb) * 0.070270;
    gl_FragColor = vec4(color, 1.0);
  }
`;

// 光柱：每個像素朝太陽的畫面位置走，累積沿途的高光。
// 除以權重總和，改取樣數不會改變曝光；畫面外的取樣直接略過（不 clamp 到邊緣）。
const RAYS_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tBright;
  uniform vec2 uSunUv;
  uniform float uAspect;
  const int SAMPLES = 32;
  void main() {
    vec2 delta = vUv - uSunUv;
    vec2 stride = delta * 0.92 / float(SAMPLES);
    // 固定的雜訊抖動：消除階梯，又不會隨時間閃爍
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    vec2 uv = vUv - stride * jitter;
    vec3 sum = vec3(0.0);
    float weight = 1.0;
    float weightSum = 0.0;
    for (int i = 0; i < SAMPLES; i++) {
      uv -= stride;
      if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        sum += min(texture2D(tBright, uv).rgb, vec3(4.0)) * weight;
      }
      weightSum += weight;
      weight *= 0.955;
    }
    float distance = length(delta * vec2(uAspect, 1.0));
    float falloff = 1.0 / (1.0 + distance * distance * 3.5);
    gl_FragColor = vec4(sum / max(weightSum, 0.0001) * falloff, 1.0);
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
  uniform float uGlow;
  uniform float uRays;
  uniform float uVignette;
  uniform float uAspect;
  ${DEPTH_GLSL}
  void main() {
    vec3 color = texture2D(tColor, vUv).rgb;

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
      // 光柱主要落在遠處的空氣裡；近處的表面（許願葉、樹幹）只吃一小部分，保住對比
      color += texture2D(tRays, vUv).rgb * uRays * mix(0.3, 1.0, smoothstep(9.0, 55.0, depth));
    #endif

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

  const settings = { dof: true, glow: true, rays: true, msaa: 4, auxScale: 1 };
  const look = { glow: 0.28, rays: 0.45, vignette: 0.3, threshold: 1.6, fStop: 1.4, maxCoc: 0.009 };
  const size = new THREE.Vector2(1, 1);

  const sceneTarget = createTarget({ depthBuffer: true, samples: settings.msaa });
  sceneTarget.depthTexture = new THREE.DepthTexture(1, 1);
  sceneTarget.depthTexture.minFilter = sceneTarget.depthTexture.magFilter = THREE.NearestFilter;

  const cocTarget = createTarget();
  const dofTarget = createTarget();
  // lens glow 的三層：1/4、1/8、1/16，各有一張暫存
  const glow = [0, 1, 2].map(() => ({ a: createTarget(), b: createTarget() }));
  const raysTarget = createTarget();
  const allTargets = [sceneTarget, cocTarget, dofTarget, raysTarget, ...glow.flatMap((g) => [g.a, g.b])];

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
  const raysMaterial = pass(RAYS_FRAGMENT, {
    tBright: { value: glow[0].a.texture },
    uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
  });
  const compositeMaterial = pass(
    COMPOSITE_FRAGMENT,
    {
      tColor: { value: sceneTarget.texture },
      tDof: { value: dofTarget.texture },
      tGlow0: { value: glow[0].a.texture },
      tGlow1: { value: glow[1].a.texture },
      tGlow2: { value: glow[2].a.texture },
      tRays: { value: raysTarget.texture },
      uGlow: { value: look.glow },
      uRays: { value: look.rays },
      uVignette: { value: look.vignette },
      uAspect: { value: 1 },
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
    raysTarget.setSize(glow[0].a.width, glow[0].a.height);

    bokehMaterial.uniforms.uTexel.value.set(1 / cocTarget.width, 1 / cocTarget.height);
    depthUniforms.uMaxCoc.value = Math.max(look.maxCoc * height, 2);
    bokehMaterial.uniforms.uRadius.value = depthUniforms.uMaxCoc.value * (cocTarget.height / height);
    compositeMaterial.uniforms.uAspect.value = raysMaterial.uniforms.uAspect.value = width / height;
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

  const sunPoint = new THREE.Vector3();
  const forward = new THREE.Vector3();
  let sunVisibility = 0;

  /** 太陽在畫面上的位置；在鏡頭後方或離畫面太遠時光柱淡出 */
  function updateSun(camera) {
    camera.getWorldDirection(forward);
    if (forward.dot(sunDirection) <= 0.05) {
      sunVisibility = 0;
      return;
    }
    sunPoint.copy(camera.position).addScaledVector(sunDirection, 100).project(camera);
    raysMaterial.uniforms.uSunUv.value.set(sunPoint.x * 0.5 + 0.5, sunPoint.y * 0.5 + 0.5);
    const offscreen = Math.max(Math.abs(sunPoint.x), Math.abs(sunPoint.y));
    sunVisibility = 1 - THREE.MathUtils.smoothstep(offscreen, 1.05, 1.7);
  }

  return {
    supported,
    settings,
    look,

    /** 切換效果與輔助 pass 的解析度比例（畫質分級用） */
    configure(next) {
      const before = { ...settings };
      Object.assign(settings, next);
      if (settings.msaa !== before.msaa) {
        sceneTarget.samples = settings.msaa;
        sceneTarget.dispose();
      }
      if (settings.auxScale !== before.auxScale) allocate();
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
      }

      const rays = settings.rays && (updateSun(camera), sunVisibility > 0.01);
      if (settings.glow || rays) {
        brightMaterial.uniforms.uThreshold.value = look.threshold;
        draw(brightMaterial, glow[0].a);
        glow.forEach((level, i) => {
          // 第一層在原尺寸做橫向；之後每層的橫向同時從上一層縮小取樣
          const source = i === 0 ? level.a : glow[i - 1].a;
          blur(source, level.b, 1 / source.width, 0);
          blur(level.b, level.a, 0, 1 / level.b.height);
        });
      }
      if (rays) draw(raysMaterial, raysTarget);

      compositeMaterial.uniforms.uGlow.value = settings.glow ? look.glow : 0;
      compositeMaterial.uniforms.uRays.value = rays ? look.rays * sunVisibility : 0;
      compositeMaterial.uniforms.uVignette.value = look.vignette;
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
