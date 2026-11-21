import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { range } from './palette.js';

// 楓樹模型由 blender/generate_trees.py 產生（npm run models）。
// GLB 內每個變體有兩個網格：Maple_<n>_Trunk 與 Maple_<n>_Foliage，
// 葉片顏色烘焙在頂點色中。
const MODEL_URL = '/models/maple_trees.glb';
const MESH_NAME = /^Maple_(\d+)_(Trunk|Foliage)/;

const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x3a2317, roughness: 1 });
const foliageMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.85,
  side: THREE.DoubleSide,
});
// 模擬逆光下葉片的透光感：讓葉片帶一點自身顏色的發光
foliageMaterial.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.38;',
  );
};

/** 載入 GLB，回傳 [{ trunk: BufferGeometry, foliage: BufferGeometry }, ...] */
async function loadVariants() {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  gltf.scene.updateMatrixWorld(true);

  const variants = [];
  gltf.scene.traverse((child) => {
    const match = child.isMesh && MESH_NAME.exec(child.name);
    if (!match) return;
    const index = Number(match[1]);
    const part = match[2].toLowerCase();
    variants[index] ??= {};
    variants[index][part] = child.geometry.clone().applyMatrix4(child.matrixWorld);
  });

  const complete = variants.filter((v) => v?.trunk && v?.foliage);
  if (complete.length === 0) throw new Error(`${MODEL_URL} 內找不到楓樹網格`);
  return complete;
}

/** 沿中央小徑兩側決定每棵樹的位置、旋轉與大小 */
function layoutTrees(rng) {
  const placements = [];
  const place = (x, z) =>
    placements.push({ x, z, rotation: rng() * Math.PI * 2, scale: range(rng, 0.95, 1.45) });

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

function createInstances(geometry, material, placements, tint) {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  placements.forEach((p, i) => {
    dummy.position.set(p.x, 0, p.z);
    dummy.rotation.y = p.rotation;
    dummy.scale.setScalar(p.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (tint) mesh.setColorAt(i, color.setScalar(p.brightness));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // 實例分布範圍大，關閉以單一包圍球為準的視錐剔除
  mesh.frustumCulled = false;
  return mesh;
}

/** 建立楓林：每個變體的枝幹與葉片各用一個 InstancedMesh 繪製 */
export async function createForest(rng) {
  const variants = await loadVariants();
  const groups = variants.map(() => []);
  for (const placement of layoutTrees(rng)) {
    placement.brightness = range(rng, 0.82, 1.0);
    groups[Math.floor(rng() * variants.length)].push(placement);
  }

  const forest = new THREE.Group();
  variants.forEach((variant, i) => {
    if (groups[i].length === 0) return;
    forest.add(
      createInstances(variant.trunk, trunkMaterial, groups[i], false),
      createInstances(variant.foliage, foliageMaterial, groups[i], true),
    );
  });
  return forest;
}
