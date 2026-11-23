import * as THREE from 'three';
import { range } from '../palette.js';
import { LANTERNS, creekDistance, groundHeight2, pathDistance } from './terrain.js';

// 溪岸與燈籠腳下的低矮草叢（概念圖的岸邊有草）：每叢幾片細長的草葉，instanced。
// 頂點色由根部的深綠漸到葉尖的黃綠；雙面、不投影（太細，投影只會變成雜點）。

function tuftGeometry() {
  const positions = [];
  const colors = [];
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + i * 0.7;
    const lean = 0.3 + (i % 3) * 0.14;
    const h = 0.6 + (i % 4) * 0.12;
    const w = 0.035;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // 一片草葉：兩個底點 + 彎向外側的葉尖
    positions.push(-dz * w, 0, dx * w, dz * w, 0, -dx * w, dx * lean, h, dz * lean);
    colors.push(0.07, 0.1, 0.03, 0.07, 0.1, 0.03, 0.42, 0.42, 0.12);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  // 草葉的法線一律朝上偏外，受光才不會一片黑一片亮
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
  n.needsUpdate = true;
  return g;
}

export function createGrass(rng, count) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
  const mesh = new THREE.InstancedMesh(tuftGeometry(), material, count);
  const dummy = new THREE.Object3D();
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 30; tries++) {
    let x;
    let z;
    const r = rng();
    if (r < 0.2) {
      const l = LANTERNS[Math.floor(rng() * LANTERNS.length)];
      const a = rng() * Math.PI * 2;
      const d = range(rng, 0.3, 1.0);
      x = l.x + Math.cos(a) * d;
      z = l.z + Math.sin(a) * d;
    } else {
      x = range(rng, -22, 22);
      z = range(rng, -14, 8);
      const d = creekDistance(x, z);
      // 水邊最多，往外遞減
      if (d < 0.98 || rng() > Math.exp(-((d - 1.15) ** 2) / 0.12)) continue;
    }
    if (pathDistance(x, z) < 0.9) continue;
    const s = range(rng, 0.14, 0.36) * (rng() < 0.15 ? 1.4 : 1);
    dummy.position.set(x, groundHeight2(x, z) - 0.02, z);
    dummy.rotation.set(range(rng, -0.12, 0.12), rng() * Math.PI * 2, range(rng, -0.12, 0.12));
    dummy.scale.set(s * range(rng, 0.8, 1.3), s * range(rng, 0.8, 1.4), s * range(rng, 0.8, 1.3));
    dummy.updateMatrix();
    mesh.setMatrixAt(placed++, dummy.matrix);
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'grass';
  return mesh;
}
