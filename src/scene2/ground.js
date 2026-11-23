import * as THREE from 'three';
import { range } from '../palette.js';
import { LANTERN_GLSL, createStoneMaterial, lanternUniforms } from './materials.js';
import {
  BRIDGE, GIANT_TREE, LANTERNS, WATER_LEVEL, creekCenter as creekCenterAt, creekDistance, groundHeight2, isWater, pathCenter, pathDistance,
} from './terrain.js';

// 場景二的地面：中央密、外圍疏的網格（小溪岸邊需要細的頂點），
// 頂點色畫出小徑的泥土、岸邊與燈籠腳下的青草青苔、其餘是楓紅落葉；樹下的 AO 也烘進頂點色。
// 地表貼圖沿用場景一的 Poly Haven forest_leaves_02（CC0）。另外有踏石與岸邊的溪石。

const SIZE = 240;
const SEGMENTS = 260;
const Z_CENTER = -10;
const smooth = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);

/** 中央密、外圍疏：u ∈ [-1, 1] → 公尺 */
const warp = (u) => (SIZE / 2) * Math.sign(u) * (0.22 * Math.abs(u) + 0.78 * Math.abs(u) ** 3);

const hash = (x, z) => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * trees：[{ x, z, scale }]（樹下 AO），回傳地面 Mesh。
 */
export function createGround2(rng, { textureSize, anisotropy }, trees) {
  const geometry = new THREE.PlaneGeometry(2, 2, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const uvs = geometry.attributes.uv;

  const path = new THREE.Color().setRGB(0.62, 0.5, 0.4);
  const litter = new THREE.Color().setRGB(1.3, 0.72, 0.45);
  const ember = new THREE.Color().setRGB(1.4, 0.5, 0.3);
  const grass = new THREE.Color().setRGB(0.42, 0.55, 0.2);
  const moss = new THREE.Color().setRGB(0.32, 0.42, 0.16);
  const mud = new THREE.Color().setRGB(0.22, 0.18, 0.14);
  const color = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    const x = warp(position.getX(i));
    const z = Z_CENTER + warp(position.getZ(i));
    const y = groundHeight2(x, z);
    position.setXYZ(i, x, y, z);
    uvs.setXY(i, x / 4.5, z / 4.5);

    const patch = 0.5 + 0.5 * Math.sin(x * 0.23 + z * 0.17 + 1.7) * Math.sin(z * 0.29 - x * 0.13);
    const fine = 0.5 + 0.5 * Math.sin(x * 0.9 - z * 0.7);
    color.copy(litter).lerp(ember, patch * 0.7);
    // 青草：沿溪岸一圈、燈籠腳下，以及零星幾塊
    const d = creekDistance(x, z);
    let green = Math.exp(-((d - 1.3) ** 2) / 0.18) * (0.55 + 0.45 * fine);
    for (const l of LANTERNS) green = Math.max(green, Math.exp(-((x - l.x) ** 2 + (z - l.z) ** 2) / 1.6) * 0.8);
    green = Math.max(green, smooth(Math.sin(x * 0.31 + 2.0) * Math.sin(z * 0.27 - 1.0), 0.55, 0.9) * 0.6);
    color.lerp(fine > 0.5 ? grass : moss, Math.min(green, 1) * 0.75);
    // 小徑
    const onPath = 1 - smooth(pathDistance(x, z), 0.7, 1.9);
    color.lerp(path, onPath * 0.85);
    // 溪床：濕泥、偏暗
    color.lerp(mud, 1 - smooth(d, 0.7, 1.05));
    // 樹下 AO
    let ao = 1;
    for (const t of trees) {
      const dx = x - t.x;
      const dz = z - t.z;
      const d2 = dx * dx + dz * dz;
      ao *= 1 - 0.45 * Math.exp(-d2 / (2 * (1.8 * t.scale) ** 2));
      ao *= 1 - 0.6 * Math.exp(-d2 / (2 * (0.55 * t.scale) ** 2));
    }
    const gx = x - GIANT_TREE.x;
    const gz = z - GIANT_TREE.z;
    ao *= 1 - 0.55 * Math.exp(-(gx * gx + gz * gz) / (2 * 9 * 9));
    color.multiplyScalar(Math.max(ao, 0.3) * (0.9 + hash(x, z) * 0.2));
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({ color: 0x6b5a34, vertexColors: true, roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, lanternUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vG2World;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvG2World = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vG2World;\n${LANTERN_GLSL}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        #ifdef USE_MAP
          vec4 groundNear = texture2D( map, vMapUv );
          vec4 groundFar = texture2D( map, vMapUv * 0.23 + vec2( 0.37, 0.11 ) );
          #ifdef USE_FOG
            float groundBlend = 0.18 + 0.55 * smoothstep( 5.0, 36.0, vFogDepth );
          #else
            float groundBlend = 0.3;
          #endif
          diffuseColor *= mix( groundNear, groundFar, groundBlend );
        #endif
        // 水邊的泥土是濕的：較暗
        float wet = 1.0 - smoothstep( ${WATER_LEVEL.toFixed(3)} + 0.02, ${WATER_LEVEL.toFixed(3)} + 0.22, vG2World.y );
        diffuseColor.rgb *= mix( 1.0, 0.55, wet );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * lanternLight( vG2World, vec3( 0.0, 1.0, 0.0 ) );`,
      );
  };
  material.customProgramCacheKey = () => 'scene2-ground';

  const loader = new THREE.TextureLoader();
  const configure = (t, { color: isColor = false, aniso = 1 } = {}) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (isColor) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const load = (name, options) => loader.loadAsync(`/textures/forest_leaves_02_${name}.jpg`).then((t) => configure(t, options));
  const ready = Promise.all([
    load(`diffuse_${textureSize}`, { color: true, aniso: anisotropy }),
    load(`nor_gl_${textureSize}`, { aniso: anisotropy }),
    load('arm_1k', { aniso: Math.min(anisotropy, 4) }),
  ])
    .then(([map, normalMap, arm]) => {
      material.color.set(0xffffff);
      material.map = map;
      material.normalMap = normalMap;
      material.normalScale.setScalar(0.5);
      material.aoMap = arm;
      material.roughnessMap = arm;
      material.needsUpdate = true;
    })
    .catch((error) => console.warn('地表貼圖載入失敗，改用純色地面', error));

  const ground = new THREE.Mesh(geometry, material);
  ground.userData.ready = ready;
  ground.receiveShadow = true;
  ground.name = 'ground-2';
  return ground;
}

/** 一顆不規則的石頭（低面數、雜訊擾動），所有溪石共用 */
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.18 * Math.sin(v.x * 3.1 + seed) * Math.sin(v.y * 2.7 - seed) + 0.1 * Math.sin(v.z * 5.3 + v.x * 2.0);
    v.multiplyScalar(n);
    // 底部壓平
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** 踏石：扁平、邊緣圓潤的石板 */
function slabGeometry() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 11, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const r = 1 + 0.12 * Math.sin(a * 3 + 1) + 0.07 * Math.sin(a * 5);
    p.setX(i, p.getX(i) * r);
    p.setZ(i, p.getZ(i) * r);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** 踏石與溪石。回傳 Group */
export function createStones(rng) {
  const group = new THREE.Group();
  group.name = 'stones';

  // 踏石：鏡頭前到橋頭、橋尾到神木
  const slabs = [];
  const addSlabs = (zFrom, zTo, step) => {
    for (let z = zFrom; z > zTo; z -= step * range(rng, 0.9, 1.1)) {
      const x = pathCenter(z) + range(rng, -0.28, 0.28);
      const s = range(rng, 0.3, 0.44) * (z < -10 ? 1.15 : 1);
      slabs.push({ x, z, s });
      // 偶爾旁邊多一顆小的
      if (rng() < 0.35) slabs.push({ x: x + (rng() < 0.5 ? -1 : 1) * range(rng, 0.45, 0.65), z: z + range(rng, -0.2, 0.2), s: s * 0.6 });
    }
  };
  addSlabs(11.2, BRIDGE.zNear + 0.15, 0.78);
  addSlabs(BRIDGE.zFar - 0.25, -25.5, 0.95);
  const slabMesh = new THREE.InstancedMesh(slabGeometry(), createStoneMaterial({ color: 0x8b867c, moss: 0.35 }), slabs.length);
  const dummy = new THREE.Object3D();
  slabs.forEach((s, i) => {
    dummy.position.set(s.x, groundHeight2(s.x, s.z) + 0.02, s.z);
    dummy.rotation.set(range(rng, -0.03, 0.03), rng() * Math.PI, range(rng, -0.03, 0.03));
    dummy.scale.set(s.s * range(rng, 1.0, 1.35), 0.07, s.s);
    dummy.updateMatrix();
    slabMesh.setMatrixAt(i, dummy.matrix);
  });
  slabMesh.receiveShadow = true;
  slabMesh.castShadow = false;
  group.add(slabMesh);

  // 溪石：沿兩岸，靠橋與燈籠的地方多一些；部分浸在水裡
  const rocks = [];
  for (let x = -26; x < 26; x += range(rng, 0.5, 1.4)) {
    for (const side of [-1, 1]) {
      if (rng() < 0.35) continue;
      // 找岸邊：從溪中心往外走到地面高過水面一點的地方
      let z = 0;
      for (let t = 0; t < 4.5; t += 0.05) {
        z = creekCenterAt(x) + side * t;
        if (!isWater(x, z, -0.02)) break;
      }
      z += side * range(rng, -0.35, 0.4);
      if (Math.abs(x - BRIDGE.x) < 1.1) continue; // 不擋橋頭
      rocks.push({ x, z, s: range(rng, 0.16, 0.42) * (rng() < 0.15 ? 1.7 : 1) });
    }
  }
  const rockMesh = new THREE.InstancedMesh(rockGeometry(2.3), createStoneMaterial({ color: 0x7d786c, moss: 0.95, mossLow: 0.6 }), rocks.length);
  rocks.forEach((r, i) => {
    dummy.position.set(r.x, Math.max(groundHeight2(r.x, r.z), WATER_LEVEL - 0.05) + r.s * 0.15, r.z);
    dummy.rotation.set(range(rng, -0.3, 0.3), rng() * Math.PI * 2, range(rng, -0.3, 0.3));
    dummy.scale.set(r.s * range(rng, 1.0, 1.5), r.s * range(rng, 0.55, 0.85), r.s * range(rng, 0.9, 1.3));
    dummy.updateMatrix();
    rockMesh.setMatrixAt(i, dummy.matrix);
  });
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  group.add(rockMesh);
  for (const m of [slabMesh, rockMesh]) m.frustumCulled = false;
  return group;
}

