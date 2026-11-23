// 楓葉季共用色票與可重現的亂數產生器

export const LEAF_COLORS = [
  0xc8281e, 0xe2491f, 0xf07a1c, 0xf5a623, 0xb81f2d, 0xd9601a, 0xf2c230,
];

export const SKY = {
  top: 0x6c7bb0,
  mid: 0xf29a5c,
  horizon: 0xffdfae,
};

export const FOG_COLOR = 0xf6c796;

/** mulberry32：固定種子，讓每次載入的場景配置一致 */
export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (rng, list) => list[Math.floor(rng() * list.length)];
export const range = (rng, min, max) => min + rng() * (max - min);

// ---- 照明與大氣：天空、霧、太陽、光柱共用同一組設定 ----

/** 指向太陽的單位向量：低角度、在鏡頭前方偏左（逆光），保持在主鏡頭的畫面內 */
export const SUN_DIRECTION = (() => {
  const azimuth = (-5 * Math.PI) / 180; // 由 -Z（鏡頭前方）往左
  const elevation = (12.5 * Math.PI) / 180;
  return {
    x: Math.sin(azimuth) * Math.cos(elevation),
    y: Math.sin(elevation),
    z: -Math.cos(azimuth) * Math.cos(elevation),
  };
})();

/** 線性空間的大氣顏色（r, g, b），天空 shader 與霧 chunk 都由這裡取值 */
export const ATMOSPHERE = {
  haze: [0.5, 0.27, 0.15], // 地平線附近、背向太陽的霧色
  hazeSun: [0.9, 0.46, 0.19], // 朝向太陽時霧被照亮的顏色
  density: 0.0105, // 地面高度（y = 0）的霧密度（每公尺）
  falloff: 0.14, // 高度衰減：越高越稀薄
};
