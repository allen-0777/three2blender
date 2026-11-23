import * as THREE from 'three';
import { LANTERNS } from './terrain.js';

// 場景二共用的 uniform 與材質：石頭（燈籠、溪石、踏石）、木頭（木橋），
// 以及「石燈籠的暖光」——黃昏與夜晚點亮後，照在附近的地面、石頭、橋與水面上。
// 燈籠光不用真的 PointLight（每個材質都要多跑一圈光源迴圈），只在需要的材質裡算距離衰減。

/** 太陽（或月亮）的方向，葉片材質的陰影外推、樹冠方位明暗共用（{ value: Vector3 }） */
export const sceneTwoSun = { value: new THREE.Vector3(0, 1, 0) };

/** 每座燈籠火袋的位置（xyz）與亮度（w，白天 0） */
export const lanternUniforms = {
  uLanterns: { value: LANTERNS.map(() => new THREE.Vector4()) },
  uLanternColor: { value: new THREE.Color(1.0, 0.62, 0.28) },
};

export const LANTERN_GLSL = /* glsl */ `
  uniform vec4 uLanterns[ ${LANTERNS.length} ];
  uniform vec3 uLanternColor;
  // 燈籠照在某一點上的光（線性，乘上反照率後當作自發光加上去）
  vec3 lanternLight( vec3 p, vec3 n ) {
    vec3 sum = vec3( 0.0 );
    for ( int i = 0; i < ${LANTERNS.length}; i++ ) {
      vec4 l = uLanterns[ i ];
      if ( l.w <= 0.0 ) continue;
      vec3 d = l.xyz - p;
      float dist2 = dot( d, d );
      float facing = 0.35 + 0.65 * max( dot( n, d * inversesqrt( dist2 + 1e-4 ) ), 0.0 );
      // 平方反比，近處壓住不要爆掉；4 公尺外很快淡掉
      float falloff = 1.0 / ( 1.0 + dist2 * 1.6 ) * ( 1.0 - smoothstep( 9.0, 30.0, dist2 ) );
      sum += uLanternColor * l.w * falloff * facing;
    }
    return sum;
  }
`;

const NOISE_GLSL = /* glsl */ `
  float s2Hash( vec3 p ) {
    p = fract( p * 0.3183099 + 0.1 );
    p *= 17.0;
    return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
  }
  float s2Noise( vec3 x ) {
    vec3 i = floor( x );
    vec3 f = fract( x );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( mix( s2Hash( i ), s2Hash( i + vec3( 1, 0, 0 ) ), f.x ),
                     mix( s2Hash( i + vec3( 0, 1, 0 ) ), s2Hash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                mix( mix( s2Hash( i + vec3( 0, 0, 1 ) ), s2Hash( i + vec3( 1, 0, 1 ) ), f.x ),
                     mix( s2Hash( i + vec3( 0, 1, 1 ) ), s2Hash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
  }
  float s2Fbm( vec3 p ) {
    return s2Noise( p ) * 0.55 + s2Noise( p * 2.3 + 4.1 ) * 0.3 + s2Noise( p * 5.1 + 1.7 ) * 0.15;
  }
`;

/**
 * 在 MeshStandardMaterial 上加：世界座標的雜訊明暗、朝上表面的青苔、燈籠光。
 * kind：'stone' | 'wood'
 */
function decorate(material, { kind, moss = 0.6, mossLow = 0 }) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, lanternUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vS2World;\nvarying vec3 vS2Normal;')
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `#include <worldpos_vertex>
        {
          mat4 s2Model = modelMatrix;
          #ifdef USE_INSTANCING
            s2Model = modelMatrix * instanceMatrix;
          #endif
          vS2World = ( s2Model * vec4( transformed, 1.0 ) ).xyz;
          vS2Normal = normalize( mat3( s2Model ) * objectNormal );
        }`,
      );
    const surface =
      kind === 'wood'
        ? /* glsl */ `
          // 木紋：沿木板長軸（世界 x 或 z，看法線取較長的那軸）拉長的雜訊，舊木頭偏灰
          vec3 woodP = vS2World * vec3( 1.0, 6.0, 1.0 );
          float grain = s2Fbm( vec3( woodP.x * 0.6, woodP.y, woodP.z * 6.0 ) ) * 0.6 + s2Fbm( vec3( woodP.x * 6.0, woodP.y, woodP.z * 0.6 ) ) * 0.4;
          diffuseColor.rgb *= 0.62 + 0.62 * grain;
          float weather = smoothstep( 0.35, 0.8, s2Fbm( vS2World * 1.3 ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.33 ) ) ) * vec3( 1.0, 0.97, 0.9 ), weather * 0.45 );
        `
        : /* glsl */ `
          // 花崗岩：大小兩層斑駁 + 細顆粒
          float mottle = s2Fbm( vS2World * 3.1 );
          float grains = s2Noise( vS2World * 38.0 );
          diffuseColor.rgb *= 0.7 + 0.45 * mottle + 0.16 * ( grains - 0.5 );
        `;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vS2World;\nvarying vec3 vS2Normal;\n${NOISE_GLSL}\n${LANTERN_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        ${surface}
        {
          // 青苔：朝上的面、低處與背陰處較多，邊界用雜訊打散
          vec3 s2N = normalize( vS2Normal );
          float up = smoothstep( 0.25, 0.85, s2N.y );
          float low = ${mossLow.toFixed(2)} * ( 1.0 - smoothstep( 0.0, 0.5, vS2World.y + 0.1 ) );
          float mossMask = smoothstep( 0.45, 0.7, s2Fbm( vS2World * 2.2 + 3.0 ) * ( up + low ) * ${moss.toFixed(2)} + 0.2 * up * ${moss.toFixed(2)} );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.11, 0.15, 0.04 ) * ( 0.7 + 0.6 * s2Noise( vS2World * 17.0 ) ), mossMask );
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * lanternLight( vS2World, normalize( vS2Normal ) );`,
      );
  };
  material.customProgramCacheKey = () => `scene2-${kind}-${moss}-${mossLow}`;
  return material;
}

export function createStoneMaterial({ color = 0x8a857a, moss = 0.6, mossLow = 0 } = {}) {
  return decorate(new THREE.MeshStandardMaterial({ color, roughness: 0.93, metalness: 0 }), { kind: 'stone', moss, mossLow });
}

export function createWoodMaterial({ color = 0x6d4a2e } = {}) {
  return decorate(new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, vertexColors: false }), {
    kind: 'wood',
    moss: 0.25,
  });
}
