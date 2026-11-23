import * as THREE from 'three';
import { ATMOSPHERE, SUN_DIRECTION } from './palette.js';

// 大氣：把 three 內建的霧換成「高度霧 + 朝太陽方向被照亮」的版本。
// 天空 shader 用同一個 mapleHaze()，遠景會溶進它背後那一塊天空的顏色，
// 地平面不再是一條顏色對不上的死線。
// 做法是覆寫 ShaderChunk，所以必須在任何材質編譯之前 import 這個模組。

const vec3 = (v) => `vec3(${v.map((n) => n.toFixed(4)).join(', ')})`;
const sun = [SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z];

/** 天空與霧共用的 GLSL：給視線方向，回傳那個方向的霧色（線性） */
export const HAZE_GLSL = /* glsl */ `
  const vec3 MAPLE_SUN_DIR = ${vec3(sun)};
  const vec3 MAPLE_HAZE = ${vec3(ATMOSPHERE.haze)};
  const vec3 MAPLE_HAZE_SUN = ${vec3(ATMOSPHERE.hazeSun)};
  vec3 mapleHaze(vec3 dir) {
    float toSun = max(dot(dir, MAPLE_SUN_DIR), 0.0);
    // 寬的前向散射 + 靠近太陽的窄亮區
    vec3 haze = mix(MAPLE_HAZE, MAPLE_HAZE_SUN, pow(toSun, 8.0) * 0.9);
    return haze + MAPLE_HAZE_SUN * pow(toSun, 40.0) * 0.55;
  }
`;

THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif
`;

// mvPosition 已含 instanceMatrix；乘上 view 旋轉的轉置回到世界座標
THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = cameraPosition + mvPosition.xyz * mat3( viewMatrix );
#endif
`;

THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${HAZE_GLSL}
#endif
`;

// 指數高度霧的解析解：密度隨高度 exp(-falloff * y) 衰減，沿視線積分
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    vec3 fogRay = vFogWorld - cameraPosition;
    float fogDistance = length( fogRay );
    vec3 fogDir = fogRay / max( fogDistance, 0.0001 );
    float fogSlope = ${ATMOSPHERE.falloff.toFixed(4)} * fogDir.y;
    fogSlope = abs( fogSlope ) < 0.0001 ? 0.0001 : fogSlope;
    float fogOptical = fogDensity * exp( - ${ATMOSPHERE.falloff.toFixed(4)} * max( cameraPosition.y, 0.0 ) )
      * ( 1.0 - exp( - fogSlope * fogDistance ) ) / fogSlope;
    float fogFactor = 1.0 - exp( - max( fogOptical, 0.0 ) );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, mapleHaze( fogDir ), fogFactor );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #endif
#endif
`;

/** 場景用的霧物件（顏色只給不走自訂 chunk 的材質當後備） */
export function createFog() {
  const [r, g, b] = ATMOSPHERE.haze;
  return new THREE.FogExp2(new THREE.Color().setRGB(r, g, b), ATMOSPHERE.density);
}
