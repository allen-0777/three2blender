import * as THREE from 'three';

export const OPEN_WINDOW = { az: [14.5, 25], el: [9, 19] };
export const SUN_WINDOWS = [{ az: -25, el: 12, r: 5 }];
const DEG = 180 / Math.PI;
const STEP = 1.5;
const between = (rng, a, b) => a + (b - a) * rng();

export function addLimbTips(limbCurves, branchCurves, rng, detail) {
  const tips = [];
  const add = (curves, steps, down, radius) => {
    for (const { curve } of curves) for (const t of steps) {
      const point = curve.getPointAt(t);
      point.x += between(rng, -0.5, 0.5);
      point.z += between(rng, -0.5, 0.5);
      point.y -= between(rng, ...down);
      tips.push({ point, radius: between(rng, ...radius) });
    }
  };
  add(limbCurves, [0.55, 0.75, 0.92], [0.6, 1], [2.2, 3]);
  if (detail !== 'low') add(branchCurves, [0.3, 0.6], [0.3, 0.5], [1.5, 2.1]);
  return tips;
}

function project(tip, { base, scale, eye }) {
  const world = tip.point.clone().sub(base).multiplyScalar(scale).add(base).sub(eye);
  const distance = world.length();
  return { az: Math.atan2(world.x, -world.z) * DEG,
    el: Math.atan2(world.y, Math.hypot(world.x, world.z)) * DEG,
    r: Math.atan(0.8 * tip.radius * scale / distance) * DEG, distance };
}

function protectedWindow(az, el, radius = 0, margin = 0) {
  const r = radius + margin;
  if (az + r > OPEN_WINDOW.az[0] && az - r < OPEN_WINDOW.az[1] &&
      el + r > OPEN_WINDOW.el[0] && el - r < OPEN_WINDOW.el[1]) return true;
  return SUN_WINDOWS.some((w) => Math.hypot(az - w.az, el - w.el) < w.r + radius);
}

/** True means this cluster intersects protected sky and must be omitted. */
export function isOpenSky(tip, { base, scale, eye, margin = 0 }) {
  const p = project(tip, { base, scale, eye });
  const radius = Math.atan(tip.radius * scale / p.distance) * DEG;
  return protectedWindow(p.az, p.el, radius, margin);
}

/** Shared projected grid for filling and deterministic coverage tests. */
export function coverageGrid(tips, options) {
  const projected = tips.map((t) => project(t, options));
  if (!projected.length) return { cells: [], holes: [], components: [], projected };
  const minAz = Math.floor(Math.min(...projected.map((p) => p.az - p.r)) / STEP);
  const maxAz = Math.ceil(Math.max(...projected.map((p) => p.az + p.r)) / STEP);
  const minEl = Math.floor(Math.min(...projected.map((p) => p.el - p.r)) / STEP);
  const maxEl = Math.ceil(Math.max(...projected.map((p) => p.el + p.r)) / STEP);
  const cells = [], map = new Map();
  for (let y = minEl; y <= maxEl; y++) for (let x = minAz; x <= maxAz; x++) {
    const az = x * STEP, el = y * STEP;
    const cell = { x, y, az, el, covered: projected.some((p) => Math.hypot(p.az - az, p.el - el) <= p.r) };
    cells.push(cell); map.set(`${x},${y}`, cell);
  }
  const hasSide = (c, dx, dy) => {
    for (let i = 1; i * STEP <= 10; i++) if (map.get(`${c.x + dx * i},${c.y + dy * i}`)?.covered) return true;
    return false;
  };
  const holes = cells.filter((c) => !c.covered && !protectedWindow(c.az, c.el, 0, 2) &&
    [[-1, 0], [1, 0], [0, -1], [0, 1]].every(([dx, dy]) => hasSide(c, dx, dy)));
  const remaining = new Map(holes.map((c) => [`${c.x},${c.y}`, c]));
  const components = [];
  for (const c of holes) {
    if (!remaining.delete(`${c.x},${c.y}`)) continue;
    const component = [c];
    for (let i = 0; i < component.length; i++) {
      const p = component[i];
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const key = `${p.x + dx},${p.y + dy}`, next = remaining.get(key);
        if (next) { remaining.delete(key); component.push(next); }
      }
    }
    components.push(component);
  }
  return { cells, holes, components, projected };
}

/** Return only filler tips; tiny sky holes intentionally survive. */
export function fillGaps(tips, { base, scale, eye, rng, maxFill }) {
  const options = { base, scale, eye };
  const grid = coverageGrid(tips, options);
  const fillers = [];
  for (const component of grid.components.filter((c) => c.length >= 3)) {
    const target = Math.ceil(component.length * 0.7);
    const covered = new Set();
    const parity = rng() < 0.5 ? 0 : 1;
    // Start with alternating cells. A 1.2° filler can be smaller than the 1.5°
    // grid spacing, so finish the other parity only until 70% is covered.
    const candidates = [...component].sort((a, b) =>
      Number(Math.abs((b.x + b.y) % 2) === parity) - Number(Math.abs((a.x + a.y) % 2) === parity));
    for (const cell of candidates) {
      if (fillers.length >= maxFill || covered.size >= target) break;
      if (covered.has(cell)) continue;
      const nearest = grid.projected.reduce((a, b) =>
        Math.hypot(a.az - cell.az, a.el - cell.el) < Math.hypot(b.az - cell.az, b.el - cell.el) ? a : b);
      const az = cell.az / DEG, el = cell.el / DEG;
      const point = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
        .multiplyScalar(nearest.distance).add(eye).sub(base).divideScalar(scale).add(base);
      const tip = { point, radius: THREE.MathUtils.clamp(nearest.distance * Math.tan(1.2 / DEG) / scale / 0.8, 1.4, 2.4), filler: true };
      if (isOpenSky(tip, { ...options, margin: 2 })) continue;
      fillers.push(tip);
      const projected = project(tip, options);
      for (const c of component) if (Math.hypot(c.az - cell.az, c.el - cell.el) <= projected.r) covered.add(c);
    }
  }
  return fillers;
}
