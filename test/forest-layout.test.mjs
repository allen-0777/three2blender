import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRng, SUN_DIRECTION } from '../src/palette.js';
import { layoutLegacy, layoutMid, layoutFar, forestPlan, forestLayout, LAYER_BUDGET } from '../src/forestLayout.js';

const fixture = JSON.parse(readFileSync(new URL('../_qa/visual/forest-density/legacy-layout.json', import.meta.url)));
test('legacy 58 placements are unchanged, including lean and RNG consumption', () => {
  assert.deepEqual(layoutLegacy(createRng(7)), fixture);
  assert.equal(fixture.length, 58);
  const rng = createRng(7);
  layoutLegacy(rng);
  assert.deepEqual(Array.from({ length: 116 }, () => rng()),
    JSON.parse(readFileSync(new URL('../_qa/visual/forest-density/legacy-rng.json', import.meta.url))));
});
test('new layers satisfy corridor, wish band, solar cone, frame and spacing', () => {
  const mid = layoutMid(fixture, createRng(7 * 31));
  const far = layoutFar([...fixture, ...mid], createRng(7 * 131));
  const occupied = [...fixture];
  for (const [layer, spacing] of [[mid, 3.2], [far, 3.5]]) for (const p of layer) {
    const d = 12 - p.z, x = Math.abs(p.x);
    assert.ok(x >= 4.2 + 0.09 * d);
    assert.ok(x <= d * 0.514 * 1.15 + 4);
    if (d < 28) assert.ok(x / (d * 0.514) >= 0.9);
    const y = 3.5 * p.scale - 1.9, distance = Math.hypot(x, y, d);
    const angle = Math.acos((p.x * SUN_DIRECTION.x + y * SUN_DIRECTION.y - d * SUN_DIRECTION.z) / distance);
    assert.ok(angle - Math.atan(2.5 * p.scale / distance) >= Math.PI / 30);
    for (const t of occupied) assert.ok(Math.hypot(p.x - t.x, p.z - t.z) >= spacing);
    occupied.push(p);
  }
});
test('tiers use deterministic priority prefixes and bounded budgets; ground excludes far', () => {
  const high = forestPlan('high');
  for (const tier of ['high', 'mid', 'low']) {
    const plan = forestPlan(tier);
    assert.deepEqual(plan, forestPlan(tier));
    assert.deepEqual(plan.near, fixture);
    for (const layer of ['mid', 'far']) {
      assert.ok(plan[layer].length <= LAYER_BUDGET[tier][layer]);
      assert.deepEqual(plan[layer], high[layer].slice(0, LAYER_BUDGET[tier][layer]));
    }
    assert.deepEqual(forestLayout(tier), [...plan.near, ...plan.mid]);
  }
});

export function glbHashes(file) {
  const bytes = readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const bin = bytes.subarray(28 + jsonLength);
  const hashes = {};
  for (const mesh of gltf.meshes) {
    const coordinates = [];
    for (const primitive of mesh.primitives) {
      const a = gltf.accessors[primitive.attributes.POSITION], view = gltf.bufferViews[a.bufferView];
      for (let i = 0; i < a.count; i++) for (let axis = 0; axis < 3; axis++) {
        coordinates.push(bin.readFloatLE((view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? 12) + axis * 4).toFixed(5));
      }
    }
    hashes[mesh.name] = createHash('sha1').update(coordinates.join(',')).digest('hex');
  }
  return hashes;
}
test('GLB ≤ 7.5 MB and exported variants 0–4 remain vertex-identical', () => {
  const file = new URL('../public/models/maple_trees.glb', import.meta.url);
  assert.ok(statSync(file).size <= 7_500_000);
  const expected = JSON.parse(readFileSync(new URL('../_qa/visual/forest-density/legacy-glb-hashes.json', import.meta.url)));
  const actual = glbHashes(file);
  assert.equal(Object.keys(actual).length, 20);
  for (const [name, hash] of Object.entries(expected)) assert.equal(actual[name], hash, name);
});
test('real GLB forest changes instance counts without rebuilding geometry', async () => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const originalModelLoad = GLTFLoader.prototype.loadAsync;
  const originalTextureLoad = THREE.TextureLoader.prototype.loadAsync;
  const bytes = readFileSync(new URL('../public/models/maple_trees.glb', import.meta.url));
  GLTFLoader.prototype.loadAsync = function () {
    return this.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  };
  THREE.TextureLoader.prototype.loadAsync = async () => new THREE.Texture();
  try {
    const { createForest } = await import('../src/trees.js');
    const forest = await createForest(createRng(7), { barkNormals: false, tierName: 'high' });
    const meshes = [];
    forest.group.traverse((o) => { if (o.isInstancedMesh) meshes.push(o); });
    assert.ok(meshes.length <= 33);
    const geometryIds = meshes.map((m) => m.geometry.uuid);
    const matrices = meshes.map((m) => Array.from(m.instanceMatrix.array));
    const highCount = meshes.reduce((n, m) => n + m.count, 0);
    for (const tier of ['mid', 'low']) {
      forest.setTier(tier);
      const plan = forestPlan(tier);
      assert.deepEqual([forest.counts.near, forest.counts.mid, forest.counts.far], [58, plan.mid.length, plan.far.length]);
      assert.deepEqual(meshes.map((m) => m.geometry.uuid), geometryIds);
      assert.deepEqual(meshes.map((m) => Array.from(m.instanceMatrix.array)), matrices);
    }
    assert.ok(meshes.reduce((n, m) => n + m.count, 0) < highCount);
    const legacy = await createForest(createRng(7), { barkNormals: false, tierName: 'high', legacy: true });
    assert.deepEqual(legacy.counts, { near: 58, mid: 0, far: 0, variantsUsed: 5 });
    assert.equal(legacy.group.children.length, 10);
  } finally {
    GLTFLoader.prototype.loadAsync = originalModelLoad;
    THREE.TextureLoader.prototype.loadAsync = originalTextureLoad;
  }
});
