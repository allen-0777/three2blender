import * as THREE from 'three';
import { LEAF_COLORS, pick, range } from './palette.js';

// 對外介面：createMapleTree(rng) 回傳一棵樹的 THREE.Group（原點在樹根）。
// 之後若改用 Blender 匯出的 glTF，只要讓這個函式回傳載入後模型的 clone 即可，
// createForest 與其他模組都不需要修改。

const trunkMaterial = new THREE.MeshStandardMaterial({
  color: 0x3a2317,
  roughness: 1,
  flatShading: true,
});

const canopyMaterials = LEAF_COLORS.map(
  (color) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }),
);

/** 不規則的 low-poly 團塊；位移量由頂點座標決定，重複頂點才不會裂開 */
function createBlobGeometry(seed) {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const position = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const n = Math.sin(v.x * 12.9 + v.y * 78.2 + v.z * 37.7 + seed * 5.3);
    v.multiplyScalar(1 + n * 0.22);
    position.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

const blobGeometries = [1, 2, 3, 4].map(createBlobGeometry);
const trunkGeometry = new THREE.CylinderGeometry(0.1, 0.24, 1, 6).translate(0, 0.5, 0);
const branchGeometry = new THREE.CylinderGeometry(0.035, 0.08, 1, 5).translate(0, 0.5, 0);

export function createMapleTree(rng) {
  const tree = new THREE.Group();
  const height = range(rng, 2.4, 3.8);

  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.scale.set(1, height, 1);
  tree.add(trunk);

  const branchCount = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < branchCount; i++) {
    const branch = new THREE.Mesh(branchGeometry, trunkMaterial);
    branch.position.y = height * range(rng, 0.5, 0.8);
    branch.rotation.set(0, rng() * Math.PI * 2, range(rng, 0.5, 1.0), 'YXZ');
    branch.scale.set(1, range(rng, 1.0, 1.6), 1);
    tree.add(branch);
  }

  // 每棵樹以一個主色為基調，混入少量鄰近色
  const baseIndex = Math.floor(rng() * canopyMaterials.length);
  const blobCount = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < blobCount; i++) {
    const material =
      rng() < 0.7 ? canopyMaterials[baseIndex] : pick(rng, canopyMaterials);
    const blob = new THREE.Mesh(pick(rng, blobGeometries), material);
    const angle = rng() * Math.PI * 2;
    const radius = i === 0 ? 0 : range(rng, 0.5, 1.25);
    blob.position.set(
      Math.cos(angle) * radius,
      height + range(rng, -0.2, 1.1),
      Math.sin(angle) * radius,
    );
    const size = range(rng, 0.85, 1.45);
    blob.scale.set(size, size * range(rng, 0.7, 0.9), size);
    blob.rotation.set(rng() * 6.28, rng() * 6.28, rng() * 6.28);
    tree.add(blob);
  }

  tree.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return tree;
}

/** 沿中央小徑兩側排列楓樹，越遠越密，形成楓林隧道 */
export function createForest(rng) {
  const forest = new THREE.Group();

  const place = (x, z) => {
    const tree = createMapleTree(rng);
    tree.position.set(x, 0, z);
    tree.rotation.y = rng() * Math.PI * 2;
    tree.scale.setScalar(range(rng, 1.0, 1.7));
    forest.add(tree);
  };

  // 緊鄰小徑的兩排
  for (let z = 7; z > -58; z -= 4.2) {
    for (const side of [-1, 1]) {
      place(side * range(rng, 3.6, 5.6), z + range(rng, -1.2, 1.2));
    }
  }
  // 外圍較稀疏的樹，補滿畫面兩側與遠景
  for (let i = 0; i < 26; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    place(side * range(rng, 8, 30), range(rng, -60, 4));
  }
  return forest;
}
