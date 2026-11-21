import * as THREE from 'three';
import { LEAF_COLORS, pick, range } from './palette.js';

// 飄落範圍（世界座標）
const AREA = { xMin: -17, xMax: 17, zMin: -32, zMax: 11, top: 12 };

/** 五裂楓葉輪廓：定義右半邊後鏡射，葉柄朝下，整體約 1 單位大 */
function createLeafGeometry() {
  const half = [
    [0.02, -0.5], [0.02, -0.3], [0.25, -0.36], [0.2, -0.22], [0.5, -0.02],
    [0.4, 0.03], [0.47, 0.2], [0.3, 0.17], [0.27, 0.25], [0.14, 0.12],
    [0.2, 0.42], [0.1, 0.36], [0, 0.52],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(half[0][0], half[0][1]);
  for (let i = 1; i < half.length; i++) shape.lineTo(half[i][0], half[i][1]);
  for (let i = half.length - 2; i >= 0; i--) shape.lineTo(-half[i][0], half[i][1]);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

const leafGeometry = createLeafGeometry();
const leafMaterial = new THREE.MeshStandardMaterial({
  roughness: 0.8,
  side: THREE.DoubleSide,
});

function createLeafMesh(count, rng) {
  const mesh = new THREE.InstancedMesh(leafGeometry, leafMaterial, count);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    color.setHex(pick(rng, LEAF_COLORS)).multiplyScalar(range(rng, 0.85, 1.15));
    mesh.setColorAt(i, color);
  }
  mesh.instanceColor.needsUpdate = true;
  // 實例分布範圍大，關閉以單一包圍球為準的視錐剔除
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * 飄落的楓葉。回傳 { mesh, update(dt, time) }。
 * speedScale 用於 prefers-reduced-motion 時放慢。
 */
export function createFallingLeaves({ count, rng, speedScale = 1 }) {
  const mesh = createLeafMesh(count, rng);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true;

  const leaves = Array.from({ length: count }, () => ({
    x: range(rng, AREA.xMin, AREA.xMax),
    y: range(rng, 0, AREA.top),
    z: range(rng, AREA.zMin, AREA.zMax),
    fall: range(rng, 0.45, 1.1),
    swayAmp: range(rng, 0.3, 1.0),
    swayFreq: range(rng, 0.6, 1.6),
    phase: rng() * Math.PI * 2,
    rx: rng() * 6.28,
    ry: rng() * 6.28,
    rz: rng() * 6.28,
    spinX: range(rng, -1.6, 1.6),
    spinY: range(rng, -1.2, 1.2),
    spinZ: range(rng, -0.8, 0.8),
    scale: range(rng, 0.18, 0.34),
  }));

  const dummy = new THREE.Object3D();

  function update(dt, time) {
    const step = dt * speedScale;
    const wind = 0.35 + Math.sin(time * 0.2) * 0.25;

    for (let i = 0; i < count; i++) {
      const leaf = leaves[i];
      const sway = time * leaf.swayFreq + leaf.phase;
      leaf.y -= leaf.fall * step;
      leaf.x += (Math.sin(sway) * leaf.swayAmp + wind) * step;
      leaf.z += Math.cos(sway * 0.7) * leaf.swayAmp * 0.5 * step;
      leaf.rx += leaf.spinX * step;
      leaf.ry += leaf.spinY * step;
      leaf.rz += leaf.spinZ * step;

      if (leaf.y < 0.03) {
        leaf.y = AREA.top + Math.random() * 3;
        leaf.x = AREA.xMin + Math.random() * (AREA.xMax - AREA.xMin);
        leaf.z = AREA.zMin + Math.random() * (AREA.zMax - AREA.zMin);
      }
      if (leaf.x > AREA.xMax) leaf.x -= AREA.xMax - AREA.xMin;

      dummy.position.set(leaf.x, leaf.y, leaf.z);
      dummy.rotation.set(leaf.rx, leaf.ry, leaf.rz);
      dummy.scale.setScalar(leaf.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(0, 0);
  return { mesh, update };
}

/** 靜止鋪在地面的落葉，增加近景細節 */
export function createGroundLeaves({ count, rng }) {
  const mesh = createLeafMesh(count, rng);
  mesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    dummy.position.set(
      range(rng, AREA.xMin - 4, AREA.xMax + 4),
      range(rng, 0.01, 0.05),
      range(rng, AREA.zMin - 6, AREA.zMax + 2),
    );
    dummy.rotation.set(
      -Math.PI / 2 + range(rng, -0.25, 0.25),
      range(rng, -0.25, 0.25),
      rng() * Math.PI * 2,
    );
    dummy.scale.setScalar(range(rng, 0.16, 0.3));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
