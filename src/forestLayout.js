import { createRng, range, SUN_DIRECTION } from './palette.js';

export const FOREST_SEED = 7;
export const LEGACY_VARIANTS = 5;
export const VARIANT_COUNT = 10;
export const LAYER_BUDGET = {
  high: { mid: 30, far: 240 },
  mid: { mid: 22, far: 180 },
  low: { mid: 10, far: 90 },
};

export function layoutLegacy(rng) {
  const leanRng = createRng(FOREST_SEED * 7919);
  const placements = [];
  const place = (x, z) =>
    placements.push({
      x,
      z,
      rotation: rng() * Math.PI * 2,
      scale: range(rng, 0.95, 1.45),
      // 每棵樹微微歪向不同方向，打破整排複製的果園感。
      // 用另一組亂數：位置與大小維持原本的配置（太陽藏在左前方那棵樹的樹冠後面）
      leanX: range(leanRng, -0.07, 0.07),
      leanZ: range(leanRng, -0.07, 0.07),
    });

  // 緊鄰小徑的兩排
  for (let z = 7; z > -58; z -= 4.2) {
    for (const side of [-1, 1]) {
      place(side * range(rng, 4.2, 6.2), z + range(rng, -1.2, 1.2));
    }
  }
  // 外圍較稀疏的樹，補滿畫面兩側與遠景
  for (let i = 0; i < 26; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    place(side * range(rng, 9, 30), range(rng, -60, 4));
  }
  return placements;
}


const HT_DESK = 0.514;
const HT_MOBILE = 0.212;

/** Placement constraints shared by both new layers; no rendering dependencies. */
export function acceptsPlacement(p, occupied, spacing) {
  const d = 12 - p.z;
  const x = Math.abs(p.x);
  if (x < 4.2 + 0.09 * d || x > d * HT_DESK * 1.15 + 4) return false;
  if (d < 28 && x / (d * HT_DESK) < 0.9) return false;
  const y = 3.5 * p.scale - 1.9;
  const distance = Math.hypot(p.x, y, d);
  const dot = (p.x * SUN_DIRECTION.x + y * SUN_DIRECTION.y - d * SUN_DIRECTION.z) / distance;
  if (Math.acos(Math.max(-1, Math.min(1, dot))) - Math.atan(2.5 * p.scale / distance) < Math.PI / 30) return false;
  return occupied.every((t) => Math.hypot(t.x - p.x, t.z - p.z) >= spacing);
}

export function layoutMid(legacy, rng) {
  const placements = [];
  const tintRng = createRng(FOREST_SEED * 389);
  for (const [lo, hi, start, end, step, jitter] of [[7, 12, -4, -48, 4.5, 1.5], [12, 20, -10, -56, 6, 2]]) {
    for (let z = start; z >= end; z -= step) for (const side of [-1, 1]) {
      const p = {
        x: side * range(rng, lo, hi), z: z + range(rng, -jitter, jitter),
        scale: range(rng, 1, 1.6), leanX: range(rng, -0.09, 0.09), leanZ: range(rng, -0.09, 0.09),
        rotation: rng() * Math.PI * 2, variant: (rng() < 0.6 ? 5 : 0) + Math.floor(rng() * 5),
        brightness: range(tintRng, 0.82, 1), tint: [1, range(tintRng, 0.9, 1.04), range(tintRng, 0.85, 1)],
      };
      if (p.variant === 9) p.rotation = (p.x > 0 ? Math.PI : 0) + range(rng, -0.5, 0.5);
      if (acceptsPlacement(p, [...legacy, ...placements], 3.2)) placements.push(p);
    }
  }
  const mobile = (p) => Math.abs(p.x) / ((12 - p.z) * HT_MOBILE) < 1.1;
  return placements.sort((a, b) => Number(mobile(b)) - Number(mobile(a)) || b.z - a.z);
}

export function layoutFar(occupied, rng) {
  const placements = [];
  // Bounded rejection sampling: candidate capacity is 300, independent of tier.
  for (let attempt = 0; attempt < 40000 && placements.length < 300; attempt++) {
    const d = range(rng, 38, 100);
    const p = {
      x: (rng() < 0.5 ? -1 : 1) * range(rng, 4.2 + 0.09 * d, d * HT_DESK * 1.15 + 4),
      z: 12 - d, scale: range(rng, 6, 11) / 7,
      width: range(rng, 1, 1.4), rotation: rng() * Math.PI * 2,
      prototype: Math.floor(rng() * 3), hue: Math.floor(rng() * 6), brightness: range(rng, 0.5, 0.75),
    };
    if (acceptsPlacement(p, [...occupied, ...placements], 3.5)) placements.push(p);
  }
  return placements.sort((a, b) => Math.abs(a.x) / (12 - a.z) - Math.abs(b.x) / (12 - b.z));
}

let candidates = null;
export function forestPlan(tierName = 'high') {
  if (!candidates) {
    const near = layoutLegacy(createRng(FOREST_SEED));
    const mid = layoutMid(near, createRng(FOREST_SEED * 31));
    const far = layoutFar([...near, ...mid], createRng(FOREST_SEED * 131));
    candidates = { near, mid, far };
  }
  const { near, mid, far } = candidates;
  const budget = LAYER_BUDGET[tierName] ?? LAYER_BUDGET.high;
  return { near: near.map((p) => ({ ...p })), mid: mid.slice(0, budget.mid).map((p) => ({ ...p, tint: [...p.tint] })), far: far.slice(0, budget.far).map((p) => ({ ...p })) };
}

export function forestLayout(tierName = 'high') {
  const { near, mid } = forestPlan(tierName);
  return [...near, ...mid];
}
