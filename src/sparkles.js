import * as THREE from 'three';
import { range } from './palette.js';

// 空氣裡的兩種小光點（一個 Points、一個 draw call）：
//   灰塵：只有在太陽照得到的地方（查陰影貼圖）才看得見，逆光時最亮——光柱裡飄浮的塵埃。
//   金色光點：少量、慢慢一明一暗地閃，帶一點點樹冠下的魔幻感，不搶許願葉的戲。
// 都是疊加混合的 HDR 光點，夠亮的會再被 lens glow 擴散一點；不寫深度、不混霧。

const AREA = { xMin: -9, xMax: 9, yMin: 0.25, yMax: 7.5, zMin: -26, zMax: 10.5 };

const VERTEX = /* glsl */ `
  attribute vec4 aSeed; // x: 相位、y: 速度、z: 種類（0 灰塵／1 金色）、w: 大小
  uniform float uTime;
  uniform float uPixelScale;
  uniform sampler2DShadow tShadow;
  uniform mat4 uShadowMatrix;
  uniform float uShadowReady;
  uniform vec3 uSunDir;
  varying vec3 vColor;
  float sunVisible( vec3 p ) {
    vec4 s = uShadowMatrix * vec4( p, 1.0 );
    if ( uShadowReady < 0.5 || any( lessThan( s.xyz, vec3( 0.0 ) ) ) || any( greaterThan( s.xyz, vec3( 1.0 ) ) ) ) return 1.0;
    return texture( tShadow, vec3( s.xy, s.z - 0.002 ) );
  }
  void main() {
    float t = uTime * aSeed.y;
    vec3 p = position + vec3(
      sin( t * 0.31 + aSeed.x ) * 0.6 + sin( t * 0.83 + aSeed.x * 2.1 ) * 0.15,
      sin( t * 0.23 + aSeed.x * 1.7 ) * 0.35 + uTime * 0.02 * ( aSeed.z > 0.5 ? 1.0 : -0.4 ),
      cos( t * 0.27 + aSeed.x * 1.3 ) * 0.6
    );
    // 垂直方向在範圍內循環
    p.y = ${AREA.yMin.toFixed(2)} + mod( p.y - ${AREA.yMin.toFixed(2)}, ${(AREA.yMax - AREA.yMin).toFixed(2)} );
    vec4 mv = modelViewMatrix * vec4( p, 1.0 );
    gl_Position = projectionMatrix * mv;
    float distance = max( - mv.z, 0.1 );
    vec3 viewDir = normalize( p - cameraPosition );
    float visible = sunVisible( p );
    if ( aSeed.z < 0.5 ) {
      // 灰塵：前向散射，背光時幾乎看不見
      float mu = max( dot( viewDir, uSunDir ), 0.0 );
      float scatter = 0.06 + pow( mu, 6.0 ) * 1.4;
      vColor = vec3( 1.0, 0.78, 0.52 ) * visible * scatter * 4.0;
      gl_PointSize = aSeed.w * uPixelScale / distance;
    } else {
      // 金色光點：大部分時間很暗，偶爾慢慢亮起來
      float twinkle = pow( 0.5 + 0.5 * sin( uTime * ( 0.35 + aSeed.y * 0.9 ) + aSeed.x * 17.0 ), 6.0 );
      vColor = vec3( 1.0, 0.72, 0.3 ) * ( 0.06 + twinkle * 5.0 ) * ( 0.45 + 0.55 * visible );
      gl_PointSize = aSeed.w * uPixelScale / distance;
    }
    // 太小的點不要閃爍：保底 1.5 px，亮度按面積折回
    float size = max( gl_PointSize, 1.5 );
    vColor *= min( gl_PointSize * gl_PointSize / ( size * size ), 1.0 );
    // 太近的點（會在景深裡變成大色塊）淡出
    vColor *= smoothstep( 1.2, 3.0, distance );
    gl_PointSize = min( size, 48.0 );
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord * 2.0 - 1.0;
    float r = dot( d, d );
    if ( r > 1.0 ) discard;
    gl_FragColor = vec4( vColor * exp( - r * 4.0 ), 1.0 );
  }
`;

/**
 * count：{ dust, gold } 的上限；setLevel(0..1) 依畫質調整實際繪製量。
 * sun：場景的太陽 DirectionalLight（取陰影貼圖）。
 */
export function createSparkles({ rng, sun, sunDirection, dust = 1400, gold = 160 }) {
  const total = dust + gold;
  const positions = new Float32Array(total * 3);
  const seeds = new Float32Array(total * 4);
  // 灰塵與金點交錯排列，setLevel 截斷時兩種按比例一起減少
  const goldEvery = Math.max(1, Math.round(total / gold));
  for (let i = 0; i < total; i++) {
    const isGold = i % goldEvery === 0;
    positions[i * 3] = range(rng, AREA.xMin, AREA.xMax);
    positions[i * 3 + 1] = range(rng, AREA.yMin, AREA.yMax);
    positions[i * 3 + 2] = range(rng, AREA.zMin, AREA.zMax);
    seeds[i * 4] = rng() * 100;
    seeds[i * 4 + 1] = range(rng, 0.5, 1.4);
    seeds[i * 4 + 2] = isGold ? 1 : 0;
    // 世界尺寸（公尺 × 像素比例）：灰塵很細，金點略大
    seeds[i * 4 + 3] = isGold ? range(rng, 0.026, 0.046) : range(rng, 0.008, 0.016);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));

  const uniforms = {
    uTime: { value: 0 },
    uPixelScale: { value: 1000 },
    tShadow: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowReady: { value: 0 },
    uSunDir: { value: sunDirection.clone() },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 4;

  return {
    points,
    /** 每幀：時間、點大小換算（畫面高度像素 / 視角），陰影貼圖 */
    update(time, camera, drawingHeight) {
      uniforms.uTime.value = time;
      uniforms.uPixelScale.value = drawingHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      const map = sun.shadow.map?.depthTexture ?? null;
      uniforms.tShadow.value = map;
      uniforms.uShadowReady.value = map ? 1 : 0;
      uniforms.uShadowMatrix.value.copy(sun.shadow.matrix);
    },
    setLevel(level) {
      geometry.setDrawRange(0, Math.round(total * Math.min(Math.max(level, 0), 1)));
    },
  };
}
