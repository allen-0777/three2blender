import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createRng } from '../src/palette.js';
import { addLimbTips, fillGaps, isOpenSky, coverageGrid } from '../src/scene2/canopyTips.js';
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
  assert.equal(addLimbTips(limbs, branches, createRng(1), 'high').length, 109);
  const low = addLimbTips(limbs, branches, createRng(1), 'low');
  assert.equal(low.length, 33);
  low.forEach((t) => assert.ok(t.radius >= 2.2 && t.radius <= 3));
});
test('filling preserves protected windows, stays bounded and reduces internal holes ≥60%', () => {
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
    assert.ok(after <= before * 0.4, `${before} → ${after}`);
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
