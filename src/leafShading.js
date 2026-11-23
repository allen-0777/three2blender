import * as THREE from 'three';

// 葉片透光：光從葉子背面打進來時，把一部分穿透到面向鏡頭的這一面。
// 透光量跟著每一盞直射光（含陰影）走，所以太陽被擋住的葉子不會自己發亮；
// 朝太陽方向看過去（逆光）時最強。取代原本無條件的 emissive。

const TRANSMISSION_PARS = /* glsl */ `
#include <lights_physical_pars_fragment>
uniform float uLeafTransmit;
uniform float uLeafForward;
void RE_Direct_Leaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float backLit = saturate( dot( - geometryNormal, directLight.direction ) );
  float towardLight = pow( saturate( dot( geometryViewDir, - directLight.direction ) ), 3.0 );
  // 穿過葉肉的光比反射光更飽和：用葉色再乘一次自己
  vec3 through = material.diffuseColor * ( 0.55 + 0.9 * material.diffuseColor );
  reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( through )
    * backLit * uLeafTransmit * ( 1.0 + uLeafForward * towardLight );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf
`;

/**
 * 回傳一個可在 onBeforeCompile 裡呼叫的函式，替 MeshStandardMaterial 加上透光。
 * transmit：透光強度；forward：朝光源看時的額外增益；
 * shadowKeep：這個材質接收平行光陰影的比例（樹冠內部互相遮蔽時留一點光穿過去）。
 */
export function leafTransmission({ transmit = 0.6, forward = 1.5, shadowKeep = 1 } = {}) {
  return (shader) => {
    shader.uniforms.uLeafTransmit = { value: transmit };
    shader.uniforms.uLeafForward = { value: forward };
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
