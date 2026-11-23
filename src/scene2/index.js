import * as THREE from 'three';
import { createRng, range } from '../palette.js';
import { createFog, setAtmosphere } from '../atmosphere.js';
import { createFoliageMaterial, createInstances, createTrunkMaterial, loadVariants } from '../trees.js';
import { createFallingLeaves, createGroundLeaves } from '../leaves.js';
import { createSparkles } from '../sparkles.js';
import { createBridge } from './bridge.js';
import { createGiantTree } from './giantTree.js';
import { createGround2, createStones } from './ground.js';
import { createGrass } from './grass.js';
import { createDistantForest } from './distant.js';
import { createLanterns } from './lantern.js';
import { sceneTwoSun } from './materials.js';
import { createPines } from './pine.js';
import { createSky2 } from './sky.js';
import { TIMES } from './timeOfDay.js';
import { createWater } from './water.js';
import {
  GIANT_TREE, LANTERNS, WATER_LEVEL, creekDistance, groundHeight2, groundNormal2, pathDistance,
} from './terrain.js';

// 場景二：神木小溪（_SPEC_場景豐富.md）。小徑 → 木橋跨小溪 → 盡頭的神木，兩側石燈籠，
// 右側少量銀杏與黑松，以楓紅為主（約 楓 75%／銀杏 15%／松 10%）。
// 和場景一共用 renderer、鏡頭、後期、許願葉；自己有一個 THREE.Scene、太陽、天空、地面。
// 可以切換午後／黃昏／夜晚（timeOfDay.js）。

// 銀杏：偏檸檬的亮黃，和楓樹的橘紅分得開
const GINKGO_HUES = [[0xf5d82a, 4], [0xf8e45a, 3], [0xecc81e, 2], [0xd9cf3a, 1], [0xc4c040, 0.4]];
const GREEN_HUES = [[0x6f8a2e, 3], [0x8a9a35, 2.2], [0xb9a83a, 1.4], [0xe0451b, 0.8], [0xc8231c, 0.5]];
const weighted = (list) => {
  const total = list.reduce((sum, [, w]) => sum + w, 0);
  return (rng) => {
    let r = rng() * total;
    for (const [hex, w] of list) {
      r -= w;
      if (r <= 0) return hex;
    }
    return list[0][0];
  };
};

// 指定位置的樹種（照概念圖：右側銀杏與黑松、左側一棵黑松、兩棵還帶綠的楓樹）
const FIXED = [
  { x: 8.8, z: -2.0, species: 'pine', height: 8.5 },
  { x: -5.9, z: -9.5, species: 'pine', height: 7.2 },
  { x: 11, z: -12, species: 'pine', height: 7.5 },
  { x: -15, z: -24, species: 'pine', height: 7 },
  { x: 7.2, z: -11.5, species: 'ginkgo' },
  { x: 13.5, z: 1.5, species: 'ginkgo' },
  { x: 5.8, z: -19, species: 'ginkgo' },
  { x: -13.5, z: -9, species: 'ginkgo' },
  { x: 11, z: -24, species: 'ginkgo' },
  { x: -12, z: 5.5, species: 'green' },
  { x: 12.5, z: -20, species: 'green' },
];

export function layoutTrees(rng) {
  const trees = [];
  const tooClose = (x, z, d = 2.8) => trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < d * d);
  for (const f of FIXED) trees.push({ ...f, scale: range(rng, 1.05, 1.3), rotation: rng() * Math.PI * 2 });
  const tryPlace = (x, z, scale) => {
    // 離溪岸至少半個溪寬（creekDistance：0 溪中心、約 0.95 水邊）
    if (creekDistance(x, z) < 1.5 || tooClose(x, z) || pathDistance(x, z) < 4.0) return;
    const gx = x - GIANT_TREE.x;
    const gz = z - GIANT_TREE.z;
    if (gx * gx + gz * gz < 12 * 12) return; // 神木周圍留空
    // 從首頁鏡頭看出去右上方的一塊天空不種楓樹：午後露出藍天，夜晚看得到月亮（照概念圖）
    const azimuth = (Math.atan2(x, 12 - z) * 180) / Math.PI;
    if (z < 2 && azimuth > 15 && azimuth < 31) return;
    trees.push({ x, z, species: 'maple', scale, rotation: rng() * Math.PI * 2 });
  };
  // 小徑兩側
  for (let z = 10; z > -27; z -= 3.0) {
    for (const side of [-1, 1]) tryPlace(side * range(rng, 4.8, 8.0), z + range(rng, -1, 1), range(rng, 1.0, 1.45));
  }
  // 外圍
  for (let i = 0; i < 70; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    tryPlace(side * range(rng, 8.5, 30), range(rng, -34, 9), range(rng, 0.95, 1.45));
  }
  // 神木兩側與後方的遠景林
  for (let i = 0; i < 22; i++) tryPlace(range(rng, -30, 30), range(rng, -52, -36), range(rng, 1.1, 1.6));
  for (const t of trees) {
    t.leanX = range(rng, -0.06, 0.06);
    t.leanZ = range(rng, -0.06, 0.06);
    t.brightness = range(rng, 0.82, 1.0);
  }
  return trees;
}

/**
 * 建立場景二（非同步：等楓樹模型與地面貼圖）。
 * quality：{ textureSize, anisotropy, shadowMapSize, barkNormals, groundLeaves, fallingLeaves, envSize, giantLeaves }
 */
export async function createSceneTwo({ renderer, quality, reducedMotion = false }) {
  const rng = createRng(20261123);
  const scene = new THREE.Scene();
  scene.fog = createFog();
  const sky = createSky2();
  scene.add(sky.mesh);

  // ---- 燈光 ----
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x000000, 0.5);
  const sun = new THREE.DirectionalLight(0xffffff, 5);
  sun.target.position.set(0, 0, -12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  sun.shadow.radius = quality.shadowMapSize > 2048 ? 5 : 2.5;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.06;
  Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 240 });
  const fill = new THREE.DirectionalLight(0xffffff, 0.2);
  fill.position.set(10, 8, 20);
  // 夜晚（與黃昏）的暖色補光：從前下方往上，像燈籠與許願葉映在樹冠下緣的光；白天強度 0
  const uplight = new THREE.DirectionalLight(0xff7a33, 0);
  uplight.position.set(2, -6, 30);
  scene.add(hemisphere, sun, sun.target, fill, uplight);

  // ---- 地形、小溪、橋、石頭、燈籠 ----
  const trees = layoutTrees(rng);
  const ground = createGround2(rng, quality, trees);
  scene.add(ground);
  const water = createWater({ envSize: quality.envSize, leafCount: reducedMotion ? 30 : 60 });
  scene.add(water.group);
  scene.add(createBridge());
  scene.add(createStones(rng));
  scene.add(createGrass(rng, quality.grass ?? 2400));
  scene.add(createDistantForest(rng));
  const lanterns = createLanterns();
  scene.add(lanterns.group);

  // ---- 樹 ----
  const giant = createGiantTree({ barkNormals: quality.barkNormals, leafBudget: quality.giantLeaves });
  scene.add(giant.group);
  scene.add(createPines(trees.filter((t) => t.species === 'pine'), createFoliageMaterial({ sunWorld: sceneTwoSun, transmit: 0.5, forward: 1.2, layers: 0.03 })));
  const [mapleVariants, ginkgoVariants, greenVariants] = await Promise.all([
    loadVariants(),
    loadVariants({ pickHue: weighted(GINKGO_HUES), seed: 3000 }),
    loadVariants({ pickHue: weighted(GREEN_HUES), seed: 5000 }),
  ]);
  const trunkMaterial = createTrunkMaterial({ barkNormals: quality.barkNormals });
  const foliageMaterial = createFoliageMaterial({ sunWorld: sceneTwoSun });
  const forest = new THREE.Group();
  forest.name = 'forest-2';
  for (const [species, variants] of [['maple', mapleVariants], ['ginkgo', ginkgoVariants], ['green', greenVariants]]) {
    const groups = variants.map(() => []);
    trees.filter((t) => t.species === species).forEach((t, i) => groups[(i * 3 + 1) % variants.length].push(t));
    variants.forEach((variant, i) => {
      if (groups[i].length === 0) return;
      forest.add(
        createInstances(variant.trunk, trunkMaterial, groups[i], false, groundHeight2),
        createInstances(variant.foliage, foliageMaterial, groups[i], true, groundHeight2),
      );
    });
  }
  scene.add(forest);

  // ---- 落葉、地上的落葉、光點 ----
  const litterSpots = [];
  for (const t of trees) {
    for (let i = 0; i < 2; i++) {
      const a = rng() * Math.PI * 2;
      const d = range(rng, 0.4, 2.0) * t.scale;
      litterSpots.push({ x: t.x + Math.cos(a) * d, z: t.z + Math.sin(a) * d, radius: range(rng, 0.6, 1.4), amount: range(rng, 0.6, 1) });
    }
  }
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const d = range(rng, 3, 9);
    litterSpots.push({ x: GIANT_TREE.x + Math.cos(a) * d, z: GIANT_TREE.z + Math.sin(a) * d, radius: range(rng, 0.8, 1.8), amount: 1 });
  }
  for (const l of LANTERNS) litterSpots.push({ x: l.x + range(rng, -0.6, 0.6), z: l.z + range(rng, -0.4, 0.4), radius: 0.6, amount: 0.7 });
  const area = { xMin: -16, xMax: 16, zMin: -36, zMax: 7.5, top: 14 };
  // 概念圖的地面鋪滿紅葉：場景二的地上落葉是同檔次場景一的 1.6 倍
  const groundLeafCapacity = Math.round(quality.groundLeaves * 1.6);
  const groundLeaves = createGroundLeaves({
    count: groundLeafCapacity,
    rng,
    spots: litterSpots,
    heightFn: groundHeight2,
    normalFn: groundNormal2,
    accept: (x, z) => creekDistance(x, z) > 1.02,
    area,
  });
  scene.add(groundLeaves);
  const fallingLeafCapacity = reducedMotion ? 250 : quality.fallingLeaves;
  const fallingLeaves = createFallingLeaves({
    count: fallingLeafCapacity,
    rng,
    speedScale: reducedMotion ? 0.4 : 1,
    area,
    heightFn: (x, z) => Math.max(groundHeight2(x, z), WATER_LEVEL),
  });
  scene.add(fallingLeaves.mesh);
  const sunDirection = new THREE.Vector3(0, 1, 0);
  const sparkles = createSparkles({ rng, sun, sunDirection, dust: reducedMotion ? 500 : 1200, gold: 220 });
  scene.add(sparkles.points);

  // ---- 時段 ----
  let timeName = 'afternoon';
  let preset = TIMES.afternoon;
  const color = new THREE.Color();
  function setTime(name) {
    timeName = TIMES[name] ? name : 'afternoon';
    preset = TIMES[timeName];
    const p = preset;
    sunDirection.set(p.sun.x, p.sun.y, p.sun.z).normalize();
    sceneTwoSun.value.copy(sunDirection);
    sun.position.copy(sun.target.position).addScaledVector(sunDirection, 90);
    sun.color.setRGB(...p.sunColor);
    sun.intensity = p.sunIntensity;
    hemisphere.color.setRGB(...p.hemi.sky);
    hemisphere.groundColor.setRGB(...p.hemi.ground);
    hemisphere.intensity = p.hemi.intensity;
    fill.color.setRGB(...p.fill.color);
    fill.intensity = p.fill.intensity;
    scene.fog.density = p.fogDensity;
    scene.fog.color.setRGB(...p.atmosphere.haze);
    scene.background = new THREE.Color(p.background);
    const u = sky.uniforms;
    u.uZenith.value.setRGB(...p.sky.zenith);
    u.uUpper.value.setRGB(...p.sky.upper);
    u.uSunDisc.value.setRGB(...p.sky.sunDisc);
    u.uSunGlow.value = p.sky.sunGlow;
    u.uClouds.value = p.sky.clouds;
    u.uCloudColor.value.setRGB(...p.sky.cloudColor);
    u.uMoon.value = p.moon;
    u.uMoonDir.value.copy(sunDirection);
    u.uStars.value = p.stars;
    lanterns.setLevel(p.lanterns);
    water.setSun(sunDirection, color.setRGB(...p.sunColor).multiplyScalar(p.sunIntensity * 0.25), p.water.glitter);
    water.setBody(color.setRGB(...p.water.body), new THREE.Color().setRGB(...p.water.fallback), new THREE.Color().setRGB(...p.water.sky));
    sparkles.setSunDirection(sunDirection);
    sparkles.setLevels(...p.sparkles);
    uplight.intensity = p.uplight;
    applyAtmosphere();
    renderer.shadowMap.needsUpdate = true;
    reflectionsDirty = true;
    return p;
  }
  /** 共用的大氣 uniform（霧與天空的地平線）換成這個時段的；切到場景二時也要呼叫 */
  function applyAtmosphere() {
    setAtmosphere({ sunDirection, ...preset.atmosphere });
  }

  let reflectionsDirty = true;
  await ground.userData.ready?.catch(() => {});

  return {
    scene,
    sun,
    sunDirection,
    giant,
    water,
    setTime,
    applyAtmosphere,
    get time() {
      return timeName;
    },
    get preset() {
      return preset;
    },
    /** 水面倒影：換時段後（陰影已更新）重拍一次 cube map。hide：拍的時候要藏的物件（許願葉等） */
    updateReflections(hide = []) {
      if (!reflectionsDirty) return false;
      reflectionsDirty = false;
      water.capture(renderer, scene, [fallingLeaves.mesh, sparkles.points, lanterns.halos, ...hide]);
      return true;
    },
    applyTier(tier) {
      fallingLeaves.setCount(Math.min(fallingLeafCapacity, reducedMotion ? 250 : tier.fallingLeaves));
      groundLeaves.count = Math.min(groundLeafCapacity, Math.round(tier.groundLeaves * 1.6));
      sparkles.setLevel(tier.sparkles);
    },
    update(dt, time, camera, drawingHeight) {
      fallingLeaves.update(dt, time);
      water.update(dt, reducedMotion ? 0 : time);
      lanterns.update(camera, time);
      sparkles.update(reducedMotion ? time * 0.3 : time, camera, drawingHeight);
    },
  };
}
