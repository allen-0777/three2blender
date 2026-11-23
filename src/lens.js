// 鏡頭：以 36 mm 寬、16:9 片門（高 20.25 mm）定義視角與薄透鏡景深。
// verticalFieldOfView / signedBlurRadius 改寫自 MengTo/Skills 的
// control-camera-lenses/demo/assets/lens.js（MIT License, Copyright (c) 2026 Meng To，
// 授權全文見 .claude/skills/MengTo-Skills-LICENSE）。

export const SENSOR_HEIGHT = 20.25; // mm

/** 焦距（mm）→ 垂直視角（度） */
export function verticalFieldOfView(mm, sensorHeight = SENSOR_HEIGHT) {
  if (!(mm > 0 && sensorHeight > 0)) throw new RangeError('Lens and sensor dimensions must be positive');
  return (2 * Math.atan(sensorHeight / (2 * mm)) * 180) / Math.PI;
}

/**
 * 薄透鏡的模糊圈半徑（輸出像素，帶正負號：比對焦面近為負、遠為正）。
 * depth / focus 單位公尺，mm 為焦距，pixelsHigh 為實際 backing buffer 的高度。
 */
export function signedBlurRadius(depth, focus, mm, fStop, sensorHeight, pixelsHigh) {
  const f = mm * 0.001;
  const near = Math.max(depth, 0.001);
  if (!(focus > f && fStop > 0 && sensorHeight > 0)) return 0;
  const diameter = ((f * f) / (fStop * (focus - f))) * (1 - focus / near);
  return (diameter * 0.5 * pixelsHigh) / (sensorHeight * 0.001);
}

/**
 * 片門對畫面比例的配合方式：橫式用 35 mm；直式（手機）畫面太窄，
 * 逐步換成較廣的 22 mm，兩側的樹才留得在畫面裡。回傳的就是實際使用的焦距。
 */
export function focalLengthForAspect(aspect, { wide = 22, normal = 35 } = {}) {
  const t = Math.min(Math.max((aspect - 0.6) / (1.3 - 0.6), 0), 1);
  return wide + (normal - wide) * t * t * (3 - 2 * t);
}
