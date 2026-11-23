import * as THREE from 'three';
import { SUN_DIRECTION } from './palette.js';

// 葉片透光：光從葉子背面打進來時，把一部分穿透到面向鏡頭的這一面。
// 透光量跟著每一盞直射光（含陰影）走，所以太陽被擋住的葉子不會自己發亮；
// 朝太陽方向看過去（逆光）時最強。取代原本無條件的 emissive。

const TRANSMISSION_PARS = /* glsl */ `
#include <lights_physical_pars_fragment>
uniform float uLeafTransmit;
uniform float uLeafForward;
uniform float uLeafLayers;
void RE_Direct_Leaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float backLit = saturate( dot( - geometryNormal, directLight.direction ) );
  float towardLight = pow( saturate( dot( geometryViewDir, - directLight.direction ) ), 3.0 );
  // 穿過葉肉的光比反射光更飽和：用葉色再乘一次自己
  vec3 through = material.diffuseColor * ( 0.55 + 0.9 * material.diffuseColor );
  // 多層葉片的散射：被前面的葉子擋住時，仍有一部分光穿過好幾層葉子透過來（偏紅、較暗）。
  // 會投影的光排在最前面，0 號平行光就是太陽，它的 color 沒有被陰影遮掉
  vec3 transmitted = directLight.color;
  #if NUM_DIR_LIGHTS > 0
    if ( uLeafLayers > 0.0 && dot( directLight.direction, directionalLights[ 0 ].direction ) > 0.999 ) {
      transmitted = max( transmitted, directionalLights[ 0 ].color * uLeafLayers * vec3( 1.0, 0.7, 0.5 ) );
    }
  #endif
  reflectedLight.directDiffuse += transmitted * BRDF_Lambert( through )
    * backLit * uLeafTransmit * ( 1.0 + uLeafForward * towardLight );
  // 側面朝鏡頭（幾乎平行光線）的葉子 backLit 接近 0，會變成黑色細刺；
  // 朝太陽看時給一點與朝向無關的前向散射
  reflectedLight.directDiffuse += transmitted * BRDF_Lambert( through ) * uLeafTransmit * towardLight * 0.35;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf
`;

/**
 * 回傳一個可在 onBeforeCompile 裡呼叫的函式，替 MeshStandardMaterial 加上透光。
 * transmit：透光強度；forward：朝光源看時的額外增益；
 * shadowKeep：這個材質接收平行光陰影的比例（樹冠內部互相遮蔽時留一點光穿過去）。
 * layers：在陰影裡仍能穿過多層葉片的透光比例（0..1，只作用在太陽上）。
 * lightOffset：查陰影時沿太陽方向外推的距離（公尺），消除薄葉片的自我遮蔽格紋。
 */
export function leafTransmission({ transmit = 0.6, forward = 1.5, shadowKeep = 1, layers = 0, lightOffset = 0.12 } = {}) {
  return (shader) => {
    // 薄葉片雙面都會進陰影貼圖，自己遮自己會出現格紋（shadow acne）。
    // 查陰影時把點沿著光的方向往外推一小段（只對葉片材質），葉子不會再擋到自己。
    if (lightOffset > 0) {
      const marker = 'shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );';
      const chunk = THREE.ShaderChunk.shadowmap_vertex;
      if (chunk.includes(marker)) {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\nuniform vec3 uLeafSunWorld;`)
          .replace(
            '#include <shadowmap_vertex>',
            chunk.replace(marker, `${marker}\n\t\t\tshadowWorldPosition.xyz += uLeafSunWorld * ${lightOffset.toFixed(3)};`),
          );
        shader.uniforms.uLeafSunWorld = { value: new THREE.Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z) };
      }
    }
    shader.uniforms.uLeafTransmit = { value: transmit };
    shader.uniforms.uLeafForward = { value: forward };
    shader.uniforms.uLeafLayers = { value: layers };
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_physical_pars_fragment>',
      TRANSMISSION_PARS,
    );
    if (shadowKeep < 1) {
      const marker = 'directionalLightShadow.shadowIntensity,';
      const chunk = THREE.ShaderChunk.lights_fragment_begin;
      if (chunk.includes(marker)) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <lights_fragment_begin>',
          chunk.replace(marker, `directionalLightShadow.shadowIntensity * ${shadowKeep.toFixed(3)},`),
        );
      }
    }
  };
}
