import * as THREE from 'three';

// 場景二（神木小溪）的地形：一條小徑從鏡頭往前，跨過橫向蜿蜒的小溪，走到盡頭的神木。
// 鏡頭基準位置與場景一相同（0, 1.9, 12），許願葉的停留位置也就和場景一一致。
// 地形只有很小的起伏（規格：不要大起伏），溪床往下凹，神木根部略為隆起。

export const WATER_LEVEL = -0.1;
/** 神木位置（樹幹中心） */
export const GIANT_TREE = { x: 0.4, z: -31 };

const smooth = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);

/** 小溪中心線的 z（隨 x 蜿蜒） */
export function creekCenter(x) {
  // 溪在鏡頭前方約 15 公尺處橫過小徑
  return -3.4 + 1.0 * Math.sin(x * 0.15) + 0.55 * Math.sin(x * 0.051 - 1.1) + 0.49;
}

/** 小溪半寬（公尺） */
export function creekHalfWidth(x) {
  // 橋的兩側水面要寬一點（概念圖：水面在橋兩邊展開），往兩旁慢慢變窄
  return 2.6 + 0.9 * Math.exp(-(x * x) / 60) + 0.45 * Math.sin(x * 0.19 + 2.0) + 0.25 * Math.sin(x * 0.083 - 0.7);
}

/** 到溪中心的正規化距離：0 中央、1 水邊附近 */
export function creekDistance(x, z) {
  return Math.abs(z - creekCenter(x)) / creekHalfWidth(x);
}

/** 小徑中心線的 x（略微彎曲） */
export function pathCenter(z) {
  return 0.18 * Math.sin(z * 0.11 + 0.4) + (z < -8 ? (z + 8) * -0.012 : 0);
}

/** 離小徑中心的距離（公尺） */
export function pathDistance(x, z) {
  return Math.abs(x - pathCenter(z));
}

/** 地表高度（公尺） */
export function groundHeight2(x, z) {
  // 小溪近岸一帶壓低，水面才露得出來
  const offPath = smooth(pathDistance(x, z), 1.0, 4.5) * (0.35 + 0.65 * smooth(creekDistance(x, z), 1.4, 3.0));
  const broad = Math.sin(x * 0.17 + 1.3) * Math.cos(z * 0.13 + 0.4) * 0.22 + Math.sin(x * 0.07 - z * 0.09) * 0.16;
  const bumps = Math.sin(x * 0.55 + z * 0.37) * 0.06 + Math.sin(z * 0.71 - x * 0.43 + 2) * 0.04;
  let h = offPath * (broad + bumps + 0.1) + 0.04;
  // 溪床：中央最深，岸邊緩緩上來
  const d = creekDistance(x, z);
  const bed = 1 - smooth(d, 0.6, 1.15);
  h = THREE.MathUtils.lerp(h, -0.55 + 0.1 * Math.sin(x * 0.4), bed);
  // 神木根部的隆起
  const tx = x - GIANT_TREE.x;
  const tz = z - GIANT_TREE.z;
  h += 0.75 * Math.exp(-(tx * tx + tz * tz) / (2 * 6.5 * 6.5));
  // 遠方略微升高，地平線不會是一條平線
  h += smooth(-z, 60, 120) * 1.6 * (0.6 + 0.4 * Math.sin(x * 0.05 + 1));
  return h;
}

export function groundNormal2(x, z, target = new THREE.Vector3()) {
  const e = 0.2;
  return target
    .set(groundHeight2(x - e, z) - groundHeight2(x + e, z), 2 * e, groundHeight2(x, z - e) - groundHeight2(x, z + e))
    .normalize();
}

/** 是不是在水面上（地表低於水面） */
export function isWater(x, z, margin = 0) {
  return groundHeight2(x, z) < WATER_LEVEL + margin;
}

/** 木橋：跨過小溪，中心在小徑與溪的交點 */
export const BRIDGE = (() => {
  const z = creekCenter(pathCenter(creekCenter(0)));
  const x = pathCenter(z);
  const half = creekHalfWidth(x) * 1.15 + 0.3;
  return { x, z, zNear: z + half, zFar: z - half, width: 1.55, rise: 0.24 };
})();

/** 石燈籠（沿路兩側 6 座：溪的近岸一對、橋後一對、再往神木一對） */
export const LANTERNS = [
  { x: -2.75, z: BRIDGE.zNear + 2.3, scale: 1.05 },
  { x: 2.85, z: BRIDGE.zNear + 2.0, scale: 1.05 },
  { x: -2.6, z: BRIDGE.zFar - 2.4, scale: 1.0 },
  { x: 2.5, z: BRIDGE.zFar - 2.8, scale: 1.0 },
  { x: -2.3, z: -19.5, scale: 0.95 },
  { x: 2.4, z: -20.2, scale: 0.95 },
];
