import * as THREE from 'three';
import { createRng, pickLeafHue, range } from '../palette.js';
import { atmosphereUniforms } from '../atmosphere.js';
import { bentLeafGeometry } from '../leaves.js';
import { LANTERN_GLSL, lanternUniforms } from './materials.js';
import { WATER_LEVEL, creekCenter, creekHalfWidth } from './terrain.js';

// 小溪水面：細碎的流動波紋（解析的正弦組合，取梯度當法線）、Fresnel 反射、太陽（月亮）的閃光。
// 反射用環境 cube map：在水面上方拍一次整個場景（載入、換時段時各拍一次），
// 楓紅、神木、天空與點亮的燈籠都會倒映在水裡；水面本身移動的只有波紋，所以不需要每幀重拍。
// 低畫質（手機）不拍 cube map，改用天空與霧色的近似反射。
// 水面上漂著幾十片落葉，順著溪流慢慢漂。

const VERTEX = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4( position, 1.0 );
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  uniform samplerCube tEnv;
  uniform float uHasEnv;
  uniform float uTime;
  uniform vec3 uSunDirW;
  uniform vec3 uSunColorW;
  uniform vec3 uBody;
  uniform vec3 uSkyFallback;
  uniform float uGlitter;
  #include <common>
  #include <fog_pars_fragment>
  ${LANTERN_GLSL}
  varying vec3 vWorld;

  // 波紋：數個方向的正弦，整體順著溪往 +x 流；回傳高度對 x、z 的偏微分
  vec2 waveSlope( vec2 p, float t ) {
    vec2 g = vec2( 0.0 );
    const int N = 6;
    for ( int i = 0; i < N; i++ ) {
      float fi = float( i );
      float a = fi * 1.7 + 0.4;
      vec2 d = normalize( vec2( cos( a ) + 1.4, sin( a ) ) );
      float k = 2.2 + fi * 1.55;
      float amp = 0.005 / ( 1.0 + fi * 0.8 );
      float phase = dot( d, p ) * k - t * ( 0.8 + fi * 0.35 ) + fi * 2.1;
      g += d * k * amp * cos( phase );
    }
    return g;
  }

  void main() {
    vec3 toCamera = cameraPosition - vWorld;
    float dist = length( toCamera );
    vec3 V = toCamera / dist;
    // 遠處的細波會鋸齒閃爍，隨距離壓平
    float detail = 1.0 - smoothstep( 10.0, 45.0, dist );
    vec2 slope = waveSlope( vWorld.xz, uTime ) * ( 0.35 + 0.65 * detail );
    vec3 N = normalize( vec3( - slope.x, 1.0, - slope.y ) );
    vec3 R = reflect( - V, N );
    R.y = abs( R.y );

    vec3 reflected;
    if ( uHasEnv > 0.5 ) {
      // 波紋越碎反射越糊：用 mip bias 模擬
      reflected = texture( tEnv, R, 2.2 ).rgb;
    } else {
      reflected = mix( mapleHaze( normalize( vec3( R.x, R.y * 0.3, R.z ) ) ), uSkyFallback, smoothstep( 0.05, 0.6, R.y ) );
    }
    float fresnel = 0.02 + 0.98 * pow( 1.0 - max( dot( N, V ), 0.0 ), 5.0 );
    fresnel = mix( 0.2, 0.92, fresnel );
    vec3 color = mix( uBody, reflected, fresnel );
    // 燈籠照在水面上
    color += uBody * lanternLight( vWorld, N ) * 0.8;
    // 太陽（月亮）在波紋上的閃光
    float sunDot = max( dot( R, uSunDirW ), 0.0 );
    color += uSunColorW * ( pow( sunDot, 1200.0 ) * 8.0 + pow( sunDot, 120.0 ) * 0.15 ) * uGlitter;
    gl_FragColor = vec4( color, 1.0 );
    #include <fog_fragment>
  }
`;

/** 沿溪的水面條帶（比溪床略寬，邊緣藏在岸下） */
function createWaterGeometry() {
  const xs = [];
  for (let x = -70; x <= 70; x += 0.6) xs.push(x);
  const rows = 8;
  const positions = [];
  const index = [];
  xs.forEach((x, i) => {
    const c = creekCenter(x);
    const hw = creekHalfWidth(x) * 1.35 + 0.6;
    for (let r = 0; r <= rows; r++) {
      positions.push(x, WATER_LEVEL, c - hw + (2 * hw * r) / rows);
    }
    if (i === 0) return;
    for (let r = 0; r < rows; r++) {
      const a = (i - 1) * (rows + 1) + r;
      const b = i * (rows + 1) + r;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/** 水面漂浮的落葉 */
function createFloatingLeaves(count, rng) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.55, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(bentLeafGeometry, material, count);
  const color = new THREE.Color();
  const leaves = [];
  for (let i = 0; i < count; i++) {
    color.setHex(pickLeafHue(rng)).multiplyScalar(range(rng, 0.6, 0.95));
    mesh.setColorAt(i, color);
    leaves.push({
      x: range(rng, -24, 24),
      lane: range(rng, -0.75, 0.75),
      speed: range(rng, 0.08, 0.22),
      spin: range(rng, -0.25, 0.25),
      angle: rng() * Math.PI * 2,
      scale: range(rng, 0.09, 0.17),
      bob: rng() * Math.PI * 2,
    });
  }
  mesh.instanceColor.needsUpdate = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  return {
    mesh,
    update(dt, time) {
      for (let i = 0; i < mesh.count; i++) {
        const l = leaves[i];
        l.x += l.speed * dt;
        if (l.x > 24) l.x -= 48;
        l.angle += l.spin * dt;
        const z = creekCenter(l.x) + l.lane * creekHalfWidth(l.x) * 0.8;
        // 兩端淡出（縮小），循環時不會突然出現
        const fade = Math.min(1, (24 - Math.abs(l.x)) / 2);
        dummy.position.set(l.x, WATER_LEVEL + 0.012 + Math.sin(time * 1.3 + l.bob) * 0.004, z);
        dummy.rotation.set(-Math.PI / 2 + Math.sin(time * 0.9 + l.bob) * 0.06, 0, l.angle, 'YXZ');
        dummy.scale.setScalar(l.scale * fade);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/**
 * 建立水面。envSize：cube map 解析度（0 = 不拍，改用近似反射）。
 * 回傳 { group, water, capture(renderer, scene), setSun(dir, color, glitter), setBody(color), update(dt, time) }
 */
export function createWater({ envSize = 256, leafCount = 60, mirrorFrom = new THREE.Vector3(0, 1.9, 11) } = {}) {
  const rng = createRng(777);
  const cubeTarget = envSize > 0
    ? new THREE.WebGLCubeRenderTarget(envSize, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter })
    : null;
  const cubeCamera = cubeTarget ? new THREE.CubeCamera(0.2, 260, cubeTarget) : null;
  // cube camera 放在「首頁鏡頭對水面的鏡像位置」：從這裡穿過水面看出去的方向，正好就是
  // 鏡頭看到水面後反射出去的方向，所以首頁鏡位的倒影在幾何上是正確的平面反射
  // （地面與溪床是單面的，從水面下看是背面、會被剔除，不會擋住）。鏡頭推軌與視差只差一點點。
  if (cubeCamera) cubeCamera.position.set(mirrorFrom.x, 2 * WATER_LEVEL - mirrorFrom.y, mirrorFrom.z);

  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    ...atmosphereUniforms,
    ...lanternUniforms,
    tEnv: { value: cubeTarget?.texture ?? null },
    uHasEnv: { value: 0 },
    uTime: { value: 0 },
    uSunDirW: { value: new THREE.Vector3(0, 1, 0) },
    uSunColorW: { value: new THREE.Color(1, 0.8, 0.6) },
    uBody: { value: new THREE.Color(0.02, 0.025, 0.02) },
    uSkyFallback: { value: new THREE.Color(0.4, 0.5, 0.7) },
    uGlitter: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, fog: true });
  const water = new THREE.Mesh(createWaterGeometry(), material);
  water.name = 'creek';
  water.receiveShadow = false;

  const floating = createFloatingLeaves(leafCount, rng);
  const group = new THREE.Group();
  group.add(water, floating.mesh);

  return {
    group,
    water,
    /** 在水面上方拍環境 cube map。hide：拍的時候要藏起來的物件（水面本身、會動的東西） */
    capture(renderer, scene, hide = []) {
      if (!cubeCamera) return;
      const hidden = [water, floating.mesh, ...hide].filter((o) => o.visible);
      hidden.forEach((o) => {
        o.visible = false;
      });
      scene.add(cubeCamera);
      cubeCamera.update(renderer, scene);
      scene.remove(cubeCamera);
      hidden.forEach((o) => {
        o.visible = true;
      });
      uniforms.uHasEnv.value = 1;
    },
    setSun(direction, color, glitter = 1) {
      uniforms.uSunDirW.value.copy(direction);
      uniforms.uSunColorW.value.copy(color);
      uniforms.uGlitter.value = glitter;
    },
    setBody(color, skyFallback) {
      uniforms.uBody.value.copy(color);
      if (skyFallback) uniforms.uSkyFallback.value.copy(skyFallback);
    },
    setLeafCount(n) {
      floating.mesh.count = Math.min(leafCount, n);
    },
    update(dt, time) {
      uniforms.uTime.value = time;
      floating.update(dt, time);
    },
    get hasEnv() {
      return uniforms.uHasEnv.value > 0.5;
    },
  };
}
