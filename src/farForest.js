import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, range } from './palette.js';
import { groundHeight } from './environment.js';

const HUES = [0xb3161f, 0xd92b1a, 0xe5601a, 0xee8a1d, 0x8e1220, 0xc43a1a];
function prototypeGeometry(kind) {
  const rng = createRng(917 + kind);
  const shapes = [
    [[-1, 4.6, 0, 2.1, 1.8], [1, 4.8, 0.3, 2, 1.7], [0, 5.5, -0.5, 1.8, 1.5]],
    [[0, 3.4, 0, 1.9, 1.3], [0.2, 4.4, 0, 1.6, 1.3], [-0.1, 5.4, 0.1, 1.3, 1.1], [0, 6.2, 0, 0.9, 0.8]],
    [[-2.1, 4.4, 0, 2.1, 1.26], [-0.6, 5.0, 0.4, 2, 1.2], [1.1, 4.9, -0.3, 2.2, 1.32], [2.4, 4.3, 0, 1.9, 1.14]],
  ];
  const parts = shapes[kind].map(([x, y, z, width, height]) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const pos = g.attributes.position;
    const colors = [];
    const phase = range(rng, 0, Math.PI * 2);
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
      const wobble = 1 + 0.15 * Math.sin(vx * 5 + vy * 3 + vz * 7 + phase);
      pos.setXYZ(i, x + vx * width * wobble, y + vy * height * wobble, z + vz * width * wobble);
      const c = 0.55 + 0.45 * (vy + 1) / 2;
      colors.push(c, c, c);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return g;
  });
  const trunk = new THREE.CylinderGeometry(0.1, 0.4, 3.3, 5).toNonIndexed();
  trunk.translate(0, 1.65, 0);
  const bark = new THREE.Color(0x2a1a12);
  const colors = new Float32Array(trunk.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) bark.toArray(colors, i);
  trunk.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  parts.push(trunk);
  const geometry = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  // Normalize the three crowns to seven metres; placements select 6–11 m.
  geometry.scale(1, 7 / geometry.boundingBox.max.y, 1);
  return geometry;
}

export function createFarForest(placements) {
  const group = new THREE.Group();
  group.name = 'far-forest';
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const batches = [];
  for (let kind = 0; kind < 3; kind++) {
    const entries = placements.map((p, priority) => ({ ...p, priority })).filter((p) => p.prototype === kind);
    const mesh = new THREE.InstancedMesh(prototypeGeometry(kind), material, entries.length);
    entries.forEach((p, i) => {
      dummy.position.set(p.x, groundHeight(p.x, p.z) - 0.1, p.z);
      dummy.rotation.set(0, p.rotation, 0);
      dummy.scale.set(p.scale * p.width, p.scale, p.scale * p.width);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.setHex(HUES[p.hue]).multiplyScalar(p.brightness * (1 - 0.25 * (12 - p.z - 38) / 62)));
    });
    mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    batches.push({ mesh, entries });
  }
  const counts = { far: placements.length };
  return { group, counts, setBudget(n) {
    counts.far = 0;
    for (const { mesh, entries } of batches) {
      mesh.count = entries.filter((p) => p.priority < n).length;
      counts.far += mesh.count;
    }
  } };
}
