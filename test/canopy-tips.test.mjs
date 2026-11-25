import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as THREE from 'three';
import { createRng } from '../src/palette.js';
import { addLimbTips, fillGaps, isOpenSky, coverageGrid, buildLobes, assignLobes, thinLobeBoundaries, carveBranchWindows, LOBE_COUNT, FILL, BOUNDARY } from '../src/scene2/canopyTips.js';
import { buildFoliage } from '../src/scene2/giantTree.js';
const options = { base: new THREE.Vector3(), scale: 1.18, eye: new THREE.Vector3(0, 1.9, 12) };
function angularTip(az, el, distance = 65, radius = 2) {
  az *= Math.PI / 180; el *= Math.PI / 180;
  return { point: new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
    .multiplyScalar(distance).add(options.eye).sub(options.base).divideScalar(options.scale).add(options.base), radius };
}
const ring = [];
for (let a = -9; a <= 9; a += 1.5) for (let e = 24; e <= 39; e += 1.5) {
  if (a <= -6 || a >= 6 || e <= 27 || e >= 36) ring.push(angularTip(a, e));
}
test('stacked tips follow limb/branch curves; low only stacks limbs', () => {
  const curve = new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(10, 10, 0));
  const limbs = Array.from({ length: 11 }, () => ({ curve }));
  const branches = Array.from({ length: 38 }, () => ({ curve }));
  assert.equal(addLimbTips(limbs, branches, createRng(1), 'high').length, 60);
  const low = addLimbTips(limbs, branches, createRng(1), 'low');
  assert.equal(low.length, 22);
  low.forEach((t) => assert.ok(t.radius >= 1.8 && t.radius <= 2.6 && t.stacked));
});
test('filling preserves windows, stays bounded and closes only part of large holes', () => {
  const extras = [angularTip(20, 14), angularTip(-25, 12)];
  assert.ok(extras.every((t) => isOpenSky(t, { ...options, margin: 2 })));
  const tips = [...ring, ...extras].filter((t) => !isOpenSky(t, { ...options, margin: 2 }));
  const before = coverageGrid(tips, options).holes.length;
  assert.ok(before > 0);
  for (const maxFill of [40, 55, 70]) {
    const fillers = fillGaps(tips, { ...options, rng: createRng(31337 * 7 + 1), maxFill });
    assert.ok(fillers.length > 0 && fillers.length <= maxFill);
    const all = [...tips, ...fillers];
    assert.ok(all.every((t) => !isOpenSky(t, { ...options, margin: 2 })));
    const after = coverageGrid(all, options).holes.length;
    assert.ok(after <= before * 0.75 && after >= before * 0.3, `${before} → ${after}`);
    assert.deepEqual(fillers, fillGaps(tips, { ...options, rng: createRng(31337 * 7 + 1), maxFill }));
  }
});
test('leaf buffers exactly respect budgets; prefix indices are complete leaves', () => {
  for (const [detail, budget] of [['high', 30000], ['mid', 20000], ['low', 11000]]) {
    const { geometry, leafCount } = buildFoliage(ring, budget, createRng(7), detail);
    assert.equal(leafCount, budget);
    assert.equal(geometry.index.count, budget * 30);
    for (const n of [11000, 20000, 30000]) {
      const count = Math.min(n, budget);
      geometry.setDrawRange(0, count * 30);
      assert.equal(geometry.drawRange.count, count * 30);
      assert.ok(geometry.index.getX(count * 30 - 1) < count * 11);
    }
    geometry.dispose();
  }
});
test('one-cell skylights survive and a zero filler budget is respected', () => {
  const tips = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
    if (x || y) tips.push(angularTip(x * 2.5, 30 + y * 2.5, 65, 1.8));
  }
  assert.equal(coverageGrid(tips, options).holes.length, 1);
  assert.equal(fillGaps(tips, { ...options, rng: createRng(7), maxFill: 70 }).length, 0);
  assert.equal(fillGaps(ring, { ...options, rng: createRng(7), maxFill: 0 }).length, 0);
});
test('giant runtime budgets keep the same buffers and only reduce drawRange', async () => {
  const originalTextureLoad = THREE.TextureLoader.prototype.loadAsync;
  THREE.TextureLoader.prototype.loadAsync = async () => new THREE.Texture();
  try {
    const { createGiantTree } = await import('../src/scene2/giantTree.js');
    const giant = createGiantTree({ barkNormals: false, leafBudget: 30000, detail: 'high' });
    const geometry = giant.foliageMesh.geometry;
    const positions = geometry.attributes.position.array;
    assert.equal(giant.leafCount, 30000);
    assert.equal(giant.lobeCount, LOBE_COUNT);
    assert.equal(giant.bareLimbCount, 3);
    assert.equal(giant.group.children.length, 2);
    assert.equal(giant.trunkMesh.geometry.attributes.position.count, 16626);
    const hash = createHash('sha256');
    for (const attribute of [...Object.values(giant.trunkMesh.geometry.attributes), giant.trunkMesh.geometry.index]) {
      hash.update(new Uint8Array(attribute.array.buffer));
    }
    assert.equal(hash.digest('hex'), 'd96b5fb38316c83e6181c9333dcbbe15cbc8391003041d05696c1c6a05c9b0b6');
    assert.ok(giant.tipCount > 0 && giant.fillerCount <= 70);
    for (const n of [20000, 11000]) {
      giant.setLeafBudget(n);
      assert.equal(giant.leavesDrawn, n);
      assert.equal(geometry.drawRange.count, n * 30);
      assert.equal(geometry.attributes.position.array, positions);
      assert.equal(giant.leafCount, 30000);
    }
    giant.setLeafBudget(30000);
    assert.equal(giant.leavesDrawn, 11000);
  } finally {
    THREE.TextureLoader.prototype.loadAsync = originalTextureLoad;
  }
});

const copyRing = () => ring.map((t) => ({ ...t, point: t.point.clone() }));
test('lobes use deterministic farthest seeds and cover every tip', () => {
  const lobes = buildLobes(ring, createRng(5));
  assert.deepEqual(lobes, buildLobes(ring, createRng(5)));
  assert.equal(lobes.length, LOBE_COUNT);
  const tips = assignLobes(copyRing(), lobes);
  for (const t of tips) {
    assert.ok(t.lobe >= 0 && t.lobe < LOBE_COUNT);
    // Farthest-point seeds themselves have d1 = 0, hence edge = 0.
    assert.ok(t.lobeEdge >= 0 && t.lobeEdge <= 1);
    if (t.lobeEdge === 0) assert.ok(t.point.equals(lobes[t.lobe].center));
  }
  assert.equal(tips.filter((t) => t.lobeEdge === 0).length, LOBE_COUNT);
});
test('boundary thinning leaves gaps while retaining at least 60% of each lobe', () => {
  const tips = Array.from({ length: LOBE_COUNT * 20 }, (_, i) => ({
    point: new THREE.Vector3(i, 0, 0), radius: 2, lobe: Math.floor(i / 20),
    lobeEdge: i % 20 < 10 ? 0.95 : i % 20 < 15 ? 0.8 : 0.2,
  }));
  const radii = new Map(tips.map((t) => [t, t.radius]));
  const kept = thinLobeBoundaries(tips, createRng(5));
  const removed = tips.filter((t) => !kept.includes(t));
  assert.ok(removed.length / tips.length >= 0.05 && removed.length / tips.length <= 0.3);
  assert.ok(removed.every((t) => t.lobeEdge > BOUNDARY.drop));
  for (let lobe = 0; lobe < LOBE_COUNT; lobe++) {
    assert.ok(kept.filter((t) => t.lobe === lobe).length >= tips.filter((t) => t.lobe === lobe).length * 0.6);
  }
  for (const t of kept) assert.equal(t.radius, radii.get(t) * (t.lobeEdge > BOUNDARY.start ? BOUNDARY.shrink : 1));
  const allBoundary = tips.map((t) => ({ ...t, lobeEdge: 1 }));
  const floor = thinLobeBoundaries(allBoundary, () => 0);
  for (let lobe = 0; lobe < LOBE_COUNT; lobe++) assert.equal(floor.filter((t) => t.lobe === lobe).length, 12);
});
test('branch corridors remove overlapping tips and gap filling honors skip', () => {
  const curve = new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(10, 0, 0));
  const tips = [1, 3, 6, 8].map((x) => ({ point: new THREE.Vector3(x, 0, 0), radius: 1 }));
  tips.push({ point: new THREE.Vector3(3, 6, 0), radius: 1 });
  const snapshot = structuredClone(tips);
  const { kept, removed } = carveBranchWindows(tips, [{ curve, u: [0.1, 0.6], r0: 0.5 }]);
  assert.deepEqual(removed, tips.slice(0, 3));
  assert.deepEqual(kept, tips.slice(3));
  assert.deepEqual(structuredClone(tips), snapshot);
  let calls = 0;
  assert.equal(fillGaps(ring, { ...options, rng: createRng(7), maxFill: 70,
    skip: () => { calls++; return true; } }).length, 0);
  assert.ok(calls > 0);
});
test('five-cell skylights stay below the fill component threshold', () => {
  const tips = [];
  for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) {
    if (Math.abs(x) + Math.abs(y) <= 1) continue;
    tips.push(angularTip(x * 1.5, 30 + y * 1.5, 65, 0.7));
  }
  assert.deepEqual(coverageGrid(tips, options).components.map((c) => c.length), [5]);
  assert.equal(FILL.minComponent, 6);
  assert.equal(fillGaps(tips, { ...options, rng: createRng(7), maxFill: 70 }).length, 0);
});
test('leaf colors, sizes and AO vary across lobes and canopy depth', () => {
  const lobes = buildLobes(ring, createRng(5));
  const tips = assignLobes(copyRing(), lobes);
  const axis = new THREE.Vector2(0, tips.reduce((sum, t) => sum + t.point.z, 0) / tips.length);
  const eye = options.eye.clone().divideScalar(options.scale);
  const { geometry } = buildFoliage(tips, 11000, createRng(7), 'high', { lobes, axis, eye });
  const { position, color, aAo } = geometry.attributes;
  const c = new THREE.Color(), hsl = {}, p = new THREE.Vector3(), q = new THREE.Vector3();
  let red = 0, gold = 0, dark = 0, min = Infinity, max = 0;
  const samples = [];
  for (let i = 0; i < 11000; i++) {
    c.fromBufferAttribute(color, i * 11 + 1).getHSL(hsl);
    if (hsl.h < 0.03 || hsl.h > 0.97) red++;
    if (hsl.h >= 0.1 && hsl.h <= 0.17) gold++;
    if (hsl.l < 0.25 && hsl.s < 0.7) dark++;
    p.fromBufferAttribute(position, i * 11 + 1);
    q.fromBufferAttribute(position, i * 11 + 9);
    const width = p.distanceTo(q);
    min = Math.min(min, width); max = Math.max(max, width);
    p.fromBufferAttribute(position, i * 11);
    samples.push({ axial: Math.hypot(p.x - axis.x, p.z - axis.y), ao: aAo.getX(i * 11) });
  }
  assert.ok(red / 11000 < 0.78, `red fraction: ${red / 11000}`);
  assert.ok(gold > 0 && dark > 0);
  assert.ok(max / min >= 2.2);
  const mean = (s) => s.reduce((sum, t) => sum + t.ao, 0) / s.length;
  // The two core priority bands (1.8 / 0.8) are contiguous, after all priority >= 2 leaves.
  const median = tips.map((t) => t.point.y).sort((a, b) => a - b)[Math.floor(tips.length / 2)];
  const weights = tips.map((t) => t.radius ** 2 * (t.point.y <= median ? 1.35 : 1) * lobes[t.lobe].density * (1 - 0.35 * t.lobeEdge));
  const total = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.max(12, Math.round(11000 * w / total)));
  let remainder = 11000 - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; remainder; i = (i + 1) % counts.length) {
    if (remainder > 0) { counts[i]++; remainder--; }
    else if (counts[i] > 12) { counts[i]--; remainder++; }
  }
  let coreStart = 0, coreCount = 0;
  const crownZ = axis.y;
  tips.forEach((t, i) => {
    const shellAndEdge = Math.ceil(counts[i] * 0.76);
    coreCount += counts[i] - shellAndEdge;
    if (t.point.y <= median || t.point.z >= crownZ) coreStart += shellAndEdge;
  });
  assert.ok(coreCount > 0);
  assert.ok(mean(samples.slice(coreStart, coreStart + coreCount)) < 0.3);
  samples.sort((a, b) => a.axial - b.axial);
  assert.ok(mean(samples.slice(0, 2200)) < mean(samples.slice(-2200)));
  geometry.dispose();
});
