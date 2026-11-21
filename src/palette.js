// 楓葉季共用色票與可重現的亂數產生器

export const LEAF_COLORS = [
  0xc8281e, 0xe2491f, 0xf07a1c, 0xf5a623, 0xb81f2d, 0xd9601a, 0xf2c230,
];

export const SKY = {
  top: 0x6c7bb0,
  mid: 0xf6ae78,
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
