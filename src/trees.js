import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRng, pickLeafHue, range } from './palette.js';
import { groundHeight } from './environment.js';
import { leafTransmission } from './leafShading.js';
import { SUN_DIRECTION } from './palette.js';

// 楓樹模型由 blender/generate_trees.py 產生（npm run models）。
// GLB 內每個變體有兩個網格：Maple_<n>_Trunk 與 Maple_<n>_Foliage，
// 葉片顏色烘焙在頂點色中。
const MODEL_URL = '/models/maple_trees.glb';
const MESH_NAME = /^Maple_(\d+)_(Trunk|Foliage)/;

// 樹幹：GLB 沒有 UV，用世界座標三向投影（triplanar）貼上樹皮。
// 側面投影的 V 軸是世界 Y，樹皮的直向裂紋會沿著樹幹走。
export function createTrunkMaterial({ barkNormals }) {
  const material = new THREE.MeshStandardMaterial({ color: 0x3a2317, roughness: 1 });
  const uniforms = {
    uBarkMap: { value: null },
    uBarkNormal: { value: null },
    uBarkArm: { value: null },
    uBarkReady: { value: 0 },
  };

  const loader = new THREE.TextureLoader();
  const load = (name, color) =>
    loader.loadAsync(`/textures/bark_brown_02_${name}_1k.jpg`).then((texture) => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
      if (color) texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    });
  Promise.all([load('diff', true), barkNormals ? load('nor_gl') : null, barkNormals ? load('arm') : null])
    .then(([map, normal, arm]) => {
      uniforms.uBarkMap.value = map;
      uniforms.uBarkNormal.value = normal;
      uniforms.uBarkArm.value = arm;
      uniforms.uBarkReady.value = 1;
      // 樹皮貼圖本身偏暗，載入後把底色調亮、偏暖
      material.color.setRGB(1.15, 0.86, 0.68);
    })
    // 載不到時維持原本的純色樹幹
    .catch((error) => console.warn('樹皮貼圖載入失敗，改用純色樹幹', error));

  if (barkNormals) material.defines = { BARK_NORMALS: '' };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vBarkPosition;\nvarying vec3 vBarkNormal;',
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        mat4 barkMatrix = modelMatrix;
        #ifdef USE_INSTANCING
          barkMatrix = modelMatrix * instanceMatrix;
        #endif
        vBarkPosition = ( barkMatrix * vec4( transformed, 1.0 ) ).xyz;
        vBarkNormal = normalize( mat3( barkMatrix ) * objectNormal );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vBarkPosition;
        varying vec3 vBarkNormal;
        uniform sampler2D uBarkMap;
        uniform sampler2D uBarkNormal;
        uniform sampler2D uBarkArm;
        uniform float uBarkReady;
        const float BARK_SCALE = 0.85;
        vec3 barkWeights() {
          vec3 w = pow( abs( normalize( vBarkNormal ) ), vec3( 4.0 ) );
          return w / ( w.x + w.y + w.z );
        }
        vec4 barkSample( sampler2D tex, vec3 w ) {
          vec3 p = vBarkPosition * BARK_SCALE;
          return texture2D( tex, p.zy ) * w.x + texture2D( tex, p.xz ) * w.y + texture2D( tex, p.xy ) * w.z;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        vec3 barkW = barkWeights();
        if ( uBarkReady > 0.5 ) {
          diffuseColor.rgb *= barkSample( uBarkMap, barkW ).rgb * 2.2;
          #ifdef BARK_NORMALS
            diffuseColor.rgb *= mix( 1.0, barkSample( uBarkArm, barkW ).r, 0.85 );
          #endif
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        #ifdef BARK_NORMALS
          if ( uBarkReady > 0.5 ) roughnessFactor *= barkSample( uBarkArm, barkW ).g;
        #endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        #ifdef BARK_NORMALS
          if ( uBarkReady > 0.5 ) {
            // 三向投影法線（UDN 混合）：各投影面的切線空間法線加回世界法線
            vec3 barkN = normalize( vBarkNormal );
            vec3 p = vBarkPosition * BARK_SCALE;
            vec3 tx = texture2D( uBarkNormal, p.zy ).xyz * 2.0 - 1.0;
            vec3 ty = texture2D( uBarkNormal, p.xz ).xyz * 2.0 - 1.0;
            vec3 tz = texture2D( uBarkNormal, p.xy ).xyz * 2.0 - 1.0;
            const float strength = 1.4;
            tx = vec3( tx.xy * strength + barkN.zy, barkN.x );
            ty = vec3( ty.xy * strength + barkN.xz, barkN.y );
            tz = vec3( tz.xy * strength + barkN.xy, barkN.z );
            vec3 worldNormal = normalize( tx.zyx * barkW.x + ty.xzy * barkW.y + tz.xyz * barkW.z );
            normal = normalize( ( viewMatrix * vec4( worldNormal, 0.0 ) ).xyz );
          }
        #endif`,
      );
  };
  return material;
}

// 樹冠：葉色在頂點色。透光跟著太陽走（見 leafShading.js）。
// 第二輪：每片葉子帶一個 AO 值（越深入樹冠越暗），以及它在樹冠裡的方位（aCrown），
// 背向太陽那一側的葉子（也就是逆光時面向鏡頭的那一側）再暗一些；陰影幾乎全部保留，
// 葉層之間的明暗層次交給陰影貼圖，不再把內部打平。
export function createFoliageMaterial({ sunWorld = null, ...options } = {}) {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const transmission = leafTransmission({ transmit: 1.6, forward: 3.2, shadowKeep: 0.94, layers: 0.09, sunWorld, ...options });
  material.onBeforeCompile = (shader) => {
    transmission(shader);
    shader.uniforms.uCanopySun = sunWorld ?? { value: new THREE.Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z) };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aAo;
        attribute vec3 aCrown;
        uniform vec3 uCanopySun;
        varying float vCanopyAo;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          vec3 crownWorld = aCrown;
          #ifdef USE_INSTANCING
            crownWorld = mat3( instanceMatrix ) * crownWorld;
          #endif
          float sunSide = dot( normalize( crownWorld + vec3( 0.0, 1e-3, 0.0 ) ), uCanopySun );
          // 樹冠朝太陽的那半邊保留全部亮度，背面往內遞減
          vCanopyAo = aAo * mix( 0.55, 1.0, smoothstep( -0.6, 0.5, sunSide ) );
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCanopyAo;')
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        // 環境光幾乎照不進樹冠深處；直射光（含透光）也被外層葉子吃掉一部分
        reflectedLight.indirectDiffuse *= vCanopyAo * vCanopyAo;
        reflectedLight.directDiffuse *= mix( 0.2, 1.0, vCanopyAo );
        reflectedLight.directSpecular *= vCanopyAo * 0.5;`,
      );
  };
  return material;
}

// ---- 樹冠重建：GLB 的葉子縮小、重新上色，再在每個葉叢裡補上更多小葉 ----
const LEAF_SHRINK = 0.6; // GLB 原本的葉片（0.24–0.38）縮成這個比例
const EXTRA_PER_CLUSTER = 22; // 每個葉叢額外補的小葉數
// 補葉用的簡化楓葉輪廓（五裂，10 個外緣點），以中心點扇形三角化
const SMALL_LEAF = [
  [0, -0.5], [0.3, -0.12], [0.5, -0.04], [0.3, 0.12], [0.36, 0.38],
  [0, 0.52], [-0.36, 0.38], [-0.3, 0.12], [-0.5, -0.04], [-0.3, -0.12],
];

/** 連通元件（union-find），回傳每個頂點的根 */
function components(index, count) {
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let t = 0; t < index.count; t += 3) {
    const a = find(index.getX(t));
    parent[find(index.getX(t + 1))] = a;
    parent[find(index.getX(t + 2))] = a;
  }
  const roots = new Int32Array(count);
  for (let i = 0; i < count; i++) roots[i] = find(i);
  return roots;
}

const smoothstep = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);

/**
 * 重建樹冠幾何：
 *  1. 找出葉叢中心的實心團塊（12 頂點、20 三角形的二十面體）→ 記下葉叢中心與半徑後丟掉（逆光時像燈籠）。
 *  2. 其餘每片葉子以自身中心縮小，換成 LEAF_HUES 的色相（每片微差），算 AO 與樹冠方位。
 *  3. 每個葉叢再補 EXTRA_PER_CLUSTER 片小葉，越靠葉叢內側越暗。
 * 回傳新的 BufferGeometry（position、normal、color、aAo、aCrown）。
 */
function rebuildFoliage(geometry, rng, pickHue = pickLeafHue) {
  const index = geometry.index;
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const count = position.count;
  const roots = components(index, count);

  const members = new Map();
  for (let i = 0; i < count; i++) {
    const root = roots[i];
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(i);
  }
  const triangleCount = new Map();
  for (let t = 0; t < index.count; t += 3) {
    const root = roots[index.getX(t)];
    triangleCount.set(root, (triangleCount.get(root) ?? 0) + 1);
  }

  const v = new THREE.Vector3();
  const centroid = (list) => {
    const c = new THREE.Vector3();
    for (const i of list) c.add(v.fromBufferAttribute(position, i));
    return c.divideScalar(list.length);
  };

  const clusters = [];
  const leaves = [];
  for (const [root, list] of members) {
    const center = centroid(list);
    if (list.length === 12 && triangleCount.get(root) === 20) {
      let extent = 0;
      for (const i of list) extent = Math.max(extent, v.fromBufferAttribute(position, i).distanceTo(center));
      clusters.push({ center, radius: extent / 0.42 });
    } else {
      leaves.push({ list, center });
    }
  }
  if (clusters.length === 0) return null;

  const crown = new THREE.Vector3();
  clusters.forEach((c) => crown.add(c.center));
  crown.divideScalar(clusters.length);
  let crownRadius = 0;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const c of clusters) {
    crownRadius = Math.max(crownRadius, c.center.distanceTo(crown));
    yMin = Math.min(yMin, c.center.y - c.radius);
    yMax = Math.max(yMax, c.center.y + c.radius);
  }
  crownRadius += 0.8;

  const nearestCluster = (p) => {
    let best = clusters[0];
    let bestD = Infinity;
    for (const c of clusters) {
      const d = c.center.distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };

  // AO：在樹冠裡的深度、在葉叢裡朝內或朝外、高度
  const outward = new THREE.Vector3();
  const inCluster = new THREE.Vector3();
  function occlusion(p) {
    const cluster = nearestCluster(p);
    const depth = p.distanceTo(crown) / crownRadius; // 0 中心 … 1 表面
    outward.subVectors(cluster.center, crown);
    if (outward.lengthSq() < 1e-6) outward.set(0, 1, 0);
    outward.normalize();
    inCluster.subVectors(p, cluster.center);
    const radial = inCluster.length() / cluster.radius; // 0 葉叢中心 … 1 葉叢外緣
    const facing = inCluster.lengthSq() > 1e-6 ? inCluster.normalize().dot(outward) : 0;
    const height = THREE.MathUtils.clamp((p.y - yMin) / (yMax - yMin), 0, 1);
    let ao = 0.1 + 0.9 * smoothstep(depth, 0.25, 0.95);
    ao *= 0.55 + 0.45 * smoothstep(radial, 0.35, 1.0);
    ao *= 0.7 + 0.3 * (0.5 + 0.5 * facing);
    ao *= 0.72 + 0.28 * height;
    return THREE.MathUtils.clamp(ao, 0.08, 1);
  }

  const color = new THREE.Color();
  const original = new THREE.Color();
  function leafColor(p, originalColor) {
    // 一半以上來自新色相分布，保留一點原本變體（樹與樹之間）的色調
    color.setHex(pickHue(rng)).lerp(originalColor, 0.3);
    // 每片微差：亮度與色相
    const hsl = {};
    color.getHSL(hsl);
    color.setHSL(hsl.h + range(rng, -0.012, 0.012), Math.min(1, hsl.s * range(rng, 0.9, 1.1)), hsl.l * range(rng, 0.85, 1.1));
    return color;
  }

  const out = { position: [], normal: [], color: [], ao: [], crown: [], index: [] };
  const pushVertex = (p, n, c, ao, crownOffset) => {
    out.position.push(p.x, p.y, p.z);
    out.normal.push(n.x, n.y, n.z);
    out.color.push(c.r, c.g, c.b);
    out.ao.push(ao);
    out.crown.push(crownOffset.x, crownOffset.y, crownOffset.z);
    return out.position.length / 3 - 1;
  };

  // 2. 原本的葉子：縮小、換色
  const remap = new Int32Array(count).fill(-1);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const crownOffset = new THREE.Vector3();
  for (const leaf of leaves) {
    const ao = occlusion(leaf.center);
    crownOffset.subVectors(leaf.center, crown).divideScalar(crownRadius);
    original.fromBufferAttribute(geometry.attributes.color, leaf.list[0]);
    const tint = leafColor(leaf.center, original).clone();
    const centerVertex = Math.min(...leaf.list);
    for (const i of leaf.list) {
      p.fromBufferAttribute(position, i).sub(leaf.center).multiplyScalar(LEAF_SHRINK).add(leaf.center);
      n.fromBufferAttribute(normal, i);
      // 葉脈匯集處略暗
      const c = i === centerVertex ? tint.clone().multiplyScalar(0.8) : tint;
      remap[i] = pushVertex(p, n, c, ao, crownOffset);
    }
  }
  for (let t = 0; t < index.count; t += 3) {
    const a = remap[index.getX(t)];
    if (a < 0) continue; // 團塊
    out.index.push(a, remap[index.getX(t + 1)], remap[index.getX(t + 2)]);
  }

  // 3. 補小葉
  const dir = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const right = new THREE.Vector3();
  const hang = new THREE.Vector3();
  const randomUnit = (target) => {
    const z = range(rng, -1, 1);
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    return target.set(r * Math.cos(a), z, r * Math.sin(a));
  };
  const corner = new THREE.Vector3();
  for (const cluster of clusters) {
    for (let k = 0; k < EXTRA_PER_CLUSTER; k++) {
      randomUnit(dir);
      if (dir.y < -0.4) dir.y *= -0.4;
      dir.normalize();
      // 葉叢外殼最密，往內也有一些（內側的會被 AO 壓暗，填補縫隙）
      const radial = Math.sqrt(range(rng, 0.12, 1)) * range(rng, 0.85, 1.12);
      const center = cluster.center.clone().addScaledVector(dir, cluster.radius * radial);
      center.y -= cluster.radius * 0.1 * radial;
      const size = range(rng, 0.13, 0.22);
      // 葉面朝外、葉尖大致下垂
      randomUnit(n).multiplyScalar(0.55).add(dir).normalize();
      randomUnit(hang).multiplyScalar(0.6).add(corner.set(0, -1, 0));
      tip.copy(hang).addScaledVector(n, -hang.dot(n));
      if (tip.lengthSq() < 1e-6) tip.set(1, 0, 0).cross(n);
      tip.normalize();
      right.crossVectors(tip, n);

      const ao = occlusion(center);
      crownOffset.subVectors(center, crown).divideScalar(crownRadius);
      const tint = leafColor(center, original.setRGB(0.6, 0.12, 0.05)).clone();
      const base = pushVertex(
        corner.copy(center).addScaledVector(n, -size * 0.1),
        n,
        tint.clone().multiplyScalar(0.8),
        ao,
        crownOffset,
      );
      for (const [x, y] of SMALL_LEAF) {
        corner.copy(center).addScaledVector(right, x * size).addScaledVector(tip, y * size);
        pushVertex(corner, n, tint, ao, crownOffset);
      }
      for (let i = 0; i < SMALL_LEAF.length; i++) {
        out.index.push(base, base + 1 + i, base + 1 + ((i + 1) % SMALL_LEAF.length));
      }
    }
  }

  const rebuilt = new THREE.BufferGeometry();
  rebuilt.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
  rebuilt.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
  rebuilt.setAttribute('color', new THREE.Float32BufferAttribute(out.color, 3));
  rebuilt.setAttribute('aAo', new THREE.Float32BufferAttribute(out.ao, 1));
  rebuilt.setAttribute('aCrown', new THREE.Float32BufferAttribute(out.crown, 3));
  rebuilt.setIndex(out.index);
  rebuilt.computeBoundingSphere();
  return rebuilt;
}

let gltfPromise = null;
/** GLB 只下載、解析一次（場景二用同一份模型換葉色） */
function loadModel() {
  gltfPromise ??= new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    return gltf;
  });
  return gltfPromise;
}

/**
 * 載入 GLB，回傳 [{ trunk: BufferGeometry, foliage: BufferGeometry }, ...]
 * pickHue：（可選）葉色挑選函式 (rng) => hex，場景二的銀杏、帶綠楓樹用；seed 讓不同樹種的葉色序列不同
 */
export async function loadVariants({ pickHue = pickLeafHue, seed = 1000 } = {}) {
  const gltf = await loadModel();

  const variants = [];
  gltf.scene.traverse((child) => {
    const match = child.isMesh && MESH_NAME.exec(child.name);
    if (!match) return;
    const index = Number(match[1]);
    const part = match[2].toLowerCase();
    variants[index] ??= {};
    variants[index][part] = child.geometry.clone().applyMatrix4(child.matrixWorld);
    if (part === 'foliage') {
      const rebuilt = rebuildFoliage(variants[index][part], createRng(seed + index), pickHue);
      if (rebuilt) variants[index][part] = rebuilt;
      else {
        // 找不到葉叢（模型格式不同）時保留原幾何，AO 一律 1
        const g = variants[index][part];
        g.setAttribute('aAo', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
        g.setAttribute('aCrown', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
      }
    }
  });

  const complete = variants.filter((v) => v?.trunk && v?.foliage);
  if (complete.length === 0) throw new Error(`${MODEL_URL} 內找不到楓樹網格`);
  return complete;
}

// 樹的配置用固定種子，地面的樹下 AO 與葉縫光斑（environment.js）也用同一份配置
export const FOREST_SEED = 7;

/** 樹的位置與大小（不含旋轉以外的亂數），給地面預先計算樹下陰暗與光斑範圍用 */
export function forestLayout() {
  return layoutTrees(createRng(FOREST_SEED));
}

/** 沿中央小徑兩側決定每棵樹的位置、旋轉與大小 */
function layoutTrees(rng) {
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

export function createInstances(geometry, material, placements, tint, heightFn = groundHeight) {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  placements.forEach((p, i) => {
    // 根部略沉進地表，避免緩坡上露出樹幹底面
    dummy.position.set(p.x, heightFn(p.x, p.z) - 0.06, p.z);
    dummy.rotation.set(p.leanX ?? 0, p.rotation, p.leanZ ?? 0);
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
export async function createForest(rng, { barkNormals = true } = {}) {
  const trunkMaterial = createTrunkMaterial({ barkNormals });
  const foliageMaterial = createFoliageMaterial();
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
