// 楓葉季共用色票與可重現的亂數產生器

export const LEAF_COLORS = [
  0xc8281e, 0xe2491f, 0xf07a1c, 0xf5a623, 0xb81f2d, 0xd9601a, 0xf2c230,
];

/**
 * 楓葉的色相分布（第二輪）：以紅、橘為主，少量金黃，極少數還帶綠。
 * 回傳 sRGB hex，權重加總不必為 1。
 */
export const LEAF_HUES = [
  [0xa3141d, 3], // 深紅
  [0xc8231c, 5], // 朱紅
  [0xe0451b, 5], // 橘紅
  [0xef721a, 4], // 橘
  [0xf29d24, 2.5], // 琥珀
  [0xf0c234, 1.2], // 金黃
  [0xb9a83a, 0.45], // 黃綠
  [0x7d8f34, 0.25], // 還沒轉紅的綠
];
const LEAF_HUE_TOTAL = LEAF_HUES.reduce((sum, [, w]) => sum + w, 0);

/** 依 LEAF_HUES 的權重挑一個顏色（hex） */
export function pickLeafHue(rng) {
  let r = rng() * LEAF_HUE_TOTAL;
  for (const [hex, weight] of LEAF_HUES) {
    r -= weight;
    if (r <= 0) return hex;
  }
  return LEAF_HUES[0][0];
}

export const SKY = {
  top: 0x9c8891,
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

/**
 * 指向太陽的單位向量：低角度逆光，在鏡頭前方偏左、藏在左側樹冠的邊緣後面，
 * 光從葉縫透出來（光柱、逆光透紅），而不是一整團露在天空中央。
 */
export const SUN_DIRECTION = (() => {
  const azimuth = (-12 * Math.PI) / 180; // 由 -Z（鏡頭前方）往左
  const elevation = (15 * Math.PI) / 180;
  return {
    x: Math.sin(azimuth) * Math.cos(elevation),
    y: Math.sin(elevation),
    z: -Math.cos(azimuth) * Math.cos(elevation),
  };
})();

/** 線性空間的大氣顏色（r, g, b），天空 shader 與霧 chunk 都由這裡取值 */
// 第二輪：霧變淡、背光側更暗，中景保留明暗層次；遠方（林子盡頭與地表邊界）另外淡出
export const ATMOSPHERE = {
  haze: [0.26, 0.15, 0.1], // 地平線附近、背向太陽的霧色
  hazeSun: [0.95, 0.5, 0.2], // 朝向太陽時霧被照亮的顏色
  density: 0.0046, // 地面高度（y = 0）的霧密度（每公尺）
  falloff: 0.16, // 高度衰減：越高越稀薄
  farStart: 62, // 從這個距離開始額外淡進霧色，藏住地表邊界
  farEnd: 116,
};
