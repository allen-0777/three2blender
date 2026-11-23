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
    vec3 haze = mix(MAPLE_HAZE, MAPLE_HAZE_SUN, pow(toSun, 6.0) * 0.85);
    return haze + MAPLE_HAZE_SUN * pow(toSun, 40.0) * 0.45;
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
    // 霧本身變淡後，遠方另外淡出，地表邊界與林子盡頭不會露出一條線
    fogFactor = max( fogFactor, smoothstep( ${ATMOSPHERE.farStart.toFixed(1)}, ${ATMOSPHERE.farEnd.toFixed(1)}, fogDistance ) );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, mapleHaze( fogDir ), fogFactor );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #endif
#endif
`;

// 陰影柔邊：r187 的 PCF 用逐像素旋轉的 Vogel disk（IGN 雜訊）。樹冠全是小葉片、幾乎每片都在半影裡，
// 逐像素的雜訊在葉子上變成一整片規則的網點。改用固定角度：半影仍然柔和（每個取樣本身是硬體 2×2 PCF），
// 但不再有網點。同樣必須在任何材質編譯之前改。
{
  const noisy = 'float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;';
  if (THREE.ShaderChunk.shadowmap_pars_fragment.includes(noisy)) {
    THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replaceAll(noisy, 'float phi = 0.7;');
  }
}

/** 場景用的霧物件（顏色只給不走自訂 chunk 的材質當後備） */
export function createFog() {
  const [r, g, b] = ATMOSPHERE.haze;
  return new THREE.FogExp2(new THREE.Color().setRGB(r, g, b), ATMOSPHERE.density);
}
