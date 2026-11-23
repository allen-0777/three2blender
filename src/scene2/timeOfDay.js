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
    // 從神木樹冠左緣底下斜射進來
    sun: direction(-25, 12),
    sunColor: [1.0, 0.74, 0.45],
    sunIntensity: 5.4,
    hemi: { sky: [1.0, 0.86, 0.7], ground: [0.3, 0.17, 0.09], intensity: 0.85 },
    fill: { color: [1.0, 0.85, 0.68], intensity: 0.28 },
    atmosphere: { haze: [0.28, 0.12, 0.05], hazeSun: [0.85, 0.4, 0.1], falloff: 0.18, farStart: 75, farEnd: 130 },
    fogDensity: 0.0014,
    sky: { zenith: [0.08, 0.26, 0.72], upper: [0.36, 0.48, 0.7], sunDisc: [3.0, 2.2, 1.4], sunGlow: 1.2, clouds: 0.3, cloudColor: [1.0, 0.86, 0.68] },
    moon: 0,
    stars: 0,
    exposure: 0.92,
    rays: { color: [1.0, 0.6, 0.26], strength: 0.075 },
    look: { contrast: 1.26, glow: 0.2, threshold: 1.8, vignette: 0.42, saturation: 1.22 },
    sparkles: [1, 1],
    uplight: 0,
    lanterns: 0,
    wishGlow: 1,
    water: { body: [0.03, 0.028, 0.02], fallback: [0.09, 0.035, 0.02], sky: [0.32, 0.42, 0.58], glitter: 1 },
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
    look: { contrast: 1.24, glow: 0.24, threshold: 1.6, vignette: 0.46, saturation: 1.1 },
    sparkles: [0.6, 0.8],
    uplight: 0.25,
    lanterns: 0.75,
    wishGlow: 1.15,
    water: { body: [0.025, 0.018, 0.02], fallback: [0.08, 0.025, 0.03], sky: [0.45, 0.22, 0.3], glitter: 1.2 },
    background: 0x8a4a4a,
  },
  // C：夜晚。深藍的天、右上角一輪明月，冷色月光；石燈籠的暖光與發光的許願葉是畫面主角
  night: {
    // 月亮在神木樹冠右側的空隙裡（index.js 在這個方向不種楓樹）
    sun: direction(19.5, 13.5),
    sunColor: [0.55, 0.68, 1.0],
    sunIntensity: 1.15,
    hemi: { sky: [0.28, 0.36, 0.62], ground: [0.05, 0.04, 0.05], intensity: 0.32 },
    fill: { color: [0.4, 0.5, 0.85], intensity: 0.07 },
    atmosphere: { haze: [0.014, 0.022, 0.055], hazeSun: [0.06, 0.09, 0.2], falloff: 0.2, farStart: 55, farEnd: 110 },
    fogDensity: 0.0026,
    sky: { zenith: [0.01, 0.018, 0.06], upper: [0.03, 0.05, 0.13], sunDisc: [0, 0, 0], sunGlow: 0, clouds: 0.12, cloudColor: [0.12, 0.15, 0.25] },
    moon: 1,
    stars: 1,
    exposure: 1.05,
    rays: { color: [0.45, 0.6, 1.0], strength: 0.022 },
    look: { contrast: 1.15, glow: 0.3, threshold: 1.3, vignette: 0.5, saturation: 1.06 },
    // 夜晚：灰塵幾乎關掉（月光下會變成像下雪的白點），金色光點像少量螢火
    sparkles: [0.05, 0.45],
    // 燈籠與許願葉的暖光從下方照亮樹冠（概念圖 C 的紅色樹冠）
    uplight: 0.9,
    lanterns: 1.6,
    wishGlow: 1.45,
    water: { body: [0.006, 0.008, 0.014], fallback: [0.006, 0.008, 0.018], sky: [0.04, 0.06, 0.13], glitter: 0.8 },
    background: 0x0b1020,
  },
};
