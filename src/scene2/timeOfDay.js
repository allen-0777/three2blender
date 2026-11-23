// 場景二的三個時段（照 Allen 選定的概念圖 A／B／C）。
// 方向用方位角（由鏡頭前方 -Z 往右為正）與仰角（度）；顏色都是線性值。

const direction = (azimuthDeg, elevationDeg) => {
  const a = (azimuthDeg * Math.PI) / 180;
  const e = (elevationDeg * Math.PI) / 180;
  return { x: Math.sin(a) * Math.cos(e), y: Math.sin(e), z: -Math.cos(a) * Math.cos(e) };
};

export const TIME_ORDER = ['afternoon', 'dusk', 'night'];
export const TIME_LABELS = { afternoon: '午後', dusk: '黃昏', night: '夜晚' };

export const TIMES = {
  // A：午後。太陽在左上、藏在神木樹冠的左緣後面，金色逆光從葉縫穿出；右上角露出一點藍天
  afternoon: {
    sun: direction(-17, 17),
    sunColor: [1.0, 0.74, 0.45],
    sunIntensity: 5.4,
    hemi: { sky: [1.0, 0.86, 0.7], ground: [0.26, 0.15, 0.08], intensity: 0.62 },
    fill: { color: [1.0, 0.85, 0.68], intensity: 0.28 },
    atmosphere: { haze: [0.3, 0.16, 0.08], hazeSun: [0.9, 0.52, 0.2], falloff: 0.14, farStart: 62, farEnd: 120 },
    fogDensity: 0.003,
    sky: { zenith: [0.12, 0.3, 0.68], upper: [0.42, 0.5, 0.62], sunDisc: [2.6, 2.1, 1.5], sunGlow: 1.0, clouds: 0.3, cloudColor: [1.0, 0.9, 0.78] },
    moon: 0,
    stars: 0,
    exposure: 0.92,
    rays: { color: [1.0, 0.62, 0.3], strength: 0.05 },
    look: { contrast: 1.24, glow: 0.2, threshold: 1.8, vignette: 0.42 },
    lanterns: 0,
    wishGlow: 1,
    water: { body: [0.03, 0.028, 0.02], fallback: [0.2, 0.07, 0.035], glitter: 1 },
    background: 0xf3c08a,
  },
  // B：黃昏。太陽剛落到神木樹幹左邊的地平線上，天空上紫下橘，石燈籠點亮
  dusk: {
    sun: direction(-7, 4.5),
    sunColor: [1.0, 0.5, 0.22],
    sunIntensity: 4.2,
    hemi: { sky: [0.75, 0.5, 0.62], ground: [0.16, 0.08, 0.06], intensity: 0.42 },
    fill: { color: [0.75, 0.55, 0.75], intensity: 0.16 },
    atmosphere: { haze: [0.2, 0.08, 0.09], hazeSun: [0.8, 0.28, 0.08], falloff: 0.14, farStart: 60, farEnd: 118 },
    fogDensity: 0.0032,
    sky: { zenith: [0.1, 0.07, 0.26], upper: [0.42, 0.12, 0.24], sunDisc: [4.5, 2.4, 1.0], sunGlow: 1.1, clouds: 0.4, cloudColor: [0.9, 0.36, 0.28] },
    moon: 0,
    stars: 0,
    exposure: 0.9,
    rays: { color: [1.0, 0.42, 0.18], strength: 0.045 },
    look: { contrast: 1.24, glow: 0.24, threshold: 1.6, vignette: 0.46 },
    lanterns: 0.75,
    wishGlow: 1.15,
    water: { body: [0.025, 0.018, 0.02], fallback: [0.16, 0.05, 0.04], glitter: 1.2 },
    background: 0x8a4a4a,
  },
  // C：夜晚。深藍的天、右上角一輪明月，冷色月光；石燈籠的暖光與發光的許願葉是畫面主角
  night: {
    sun: direction(30, 17),
    sunColor: [0.55, 0.68, 1.0],
    sunIntensity: 1.15,
    hemi: { sky: [0.28, 0.36, 0.62], ground: [0.05, 0.04, 0.05], intensity: 0.32 },
    fill: { color: [0.4, 0.5, 0.85], intensity: 0.07 },
    atmosphere: { haze: [0.018, 0.028, 0.065], hazeSun: [0.08, 0.12, 0.24], falloff: 0.15, farStart: 55, farEnd: 110 },
    fogDensity: 0.0035,
    sky: { zenith: [0.01, 0.018, 0.06], upper: [0.03, 0.05, 0.13], sunDisc: [0, 0, 0], sunGlow: 0, clouds: 0.12, cloudColor: [0.12, 0.15, 0.25] },
    moon: 1,
    stars: 1,
    exposure: 1.05,
    rays: { color: [0.45, 0.6, 1.0], strength: 0.035 },
    look: { contrast: 1.15, glow: 0.3, threshold: 1.3, vignette: 0.5 },
    lanterns: 1.6,
    wishGlow: 1.45,
    water: { body: [0.006, 0.008, 0.014], fallback: [0.012, 0.014, 0.03], glitter: 0.8 },
    background: 0x0b1020,
  },
};
