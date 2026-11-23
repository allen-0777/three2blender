import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { range } from './palette.js';
import { groundHeight } from './environment.js';
import { leafTransmission } from './leafShading.js';

// 楓樹模型由 blender/generate_trees.py 產生（npm run models）。
// GLB 內每個變體有兩個網格：Maple_<n>_Trunk 與 Maple_<n>_Foliage，
// 葉片顏色烘焙在頂點色中。
const MODEL_URL = '/models/maple_trees.glb';
const MESH_NAME = /^Maple_(\d+)_(Trunk|Foliage)/;

// 樹幹：GLB 沒有 UV，用世界座標三向投影（triplanar）貼上樹皮。
// 側面投影的 V 軸是世界 Y，樹皮的直向裂紋會沿著樹幹走。
function createTrunkMaterial({ barkNormals }) {
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

// 樹冠：葉色烘焙在頂點色。透光跟著太陽走（見 leafShading.js），不再無條件自發光；
// 樹冠內部彼此的陰影只保留一部分，模擬光在葉層之間散開。
function createFoliageMaterial() {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = leafTransmission({ transmit: 0.8, forward: 1.6, shadowKeep: 0.45 });
  return material;
}

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
    // 根部略沉進地表，避免緩坡上露出樹幹底面
    dummy.position.set(p.x, groundHeight(p.x, p.z) - 0.06, p.z);
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
