import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, pickLeafHue, range } from '../palette.js';
import { createTrunkMaterial, createFoliageMaterial } from '../trees.js';
import { GIANT_TREE, groundHeight2 } from './terrain.js';
import { sceneTwoSun } from './materials.js';

// 神木：小路盡頭一棵比其他樹大三倍的老楓樹，當作視線的終點。
// 全部程式生成：粗壯、有板根的樹幹分出五、六根大枝，往兩側與上方展開，
// 再分成小枝；小枝末端是葉叢，葉叢由數千片小楓葉組成（同一個樹冠材質、帶 AO 與樹冠方位）。

const TAU = Math.PI * 2;

/**
 * 沿曲線長一根管子，半徑由 radius(u) 決定；bumps 讓樹幹表面有縱向的稜（老樹的板根與皺褶）。
 */
function tube(curve, radius, { segments = 20, sides = 12, bumps = 0, bumpSeed = 0 } = {}) {
  const frames = curve.computeFrenetFrames(segments, false);
  const positions = [];
  const index = [];
  const point = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    curve.getPointAt(u, point);
    const r = radius(u);
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * TAU;
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      // 縱向的稜：越靠近根部越明顯
      const ridge = bumps
        ? 1 + bumps * (1 - u) * (0.55 * Math.sin(a * 5 + bumpSeed + u * 2.0) + 0.3 * Math.sin(a * 9 + bumpSeed * 2.3 - u * 3.0))
        : 1;
      positions.push(point.x + n.x * r * ridge, point.y + n.y * r * ridge, point.z + n.z * r * ridge);
    }
  }
  const ring = sides + 1;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * ring + j;
      index.push(a, a + ring, a + 1, a + 1, a + ring, a + ring + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** 一段微彎的枝條曲線：從 start 沿 dir 長 length，中途隨機偏折、末端略為下垂 */
function bentCurve(start, dir, length, rng, droop = 0) {
  const points = [start.clone()];
  const d = dir.clone().normalize();
  const p = start.clone();
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    const wobble = new THREE.Vector3(range(rng, -1, 1), range(rng, -0.5, 0.5), range(rng, -1, 1)).multiplyScalar(0.16);
    d.add(wobble).normalize();
    d.y -= droop * (i / steps) * 0.25;
    d.normalize();
    p.addScaledVector(d, length / steps);
    points.push(p.clone());
  }
  return new THREE.CatmullRomCurve3(points, false, 'centripetal');
}

// 補葉用的簡化楓葉輪廓（五裂），以中心點扇形三角化
const LEAF = [
  [0, -0.5], [0.3, -0.12], [0.5, -0.04], [0.3, 0.12], [0.36, 0.38],
  [0, 0.52], [-0.36, 0.38], [-0.3, 0.12], [-0.5, -0.04], [-0.3, -0.12],
];

/** 神木偏愛鮮紅與朱紅（概念圖的主角），少量橘 */
function giantHue(rng) {
  const r = rng();
  if (r < 0.34) return 0xb3161c;
  if (r < 0.68) return 0xd0261c;
  if (r < 0.86) return 0xe2491f;
  return pickLeafHue(rng);
}

/**
 * 建立神木。leafBudget：葉片總數（依畫質）。
 * 回傳 { group, trunkMesh, foliageMesh, crown: { center, radius } }
 */
export function createGiantTree({ barkNormals = true, leafBudget = 16000 } = {}) {
  const rng = createRng(31337);
  const base = new THREE.Vector3(GIANT_TREE.x, groundHeight2(GIANT_TREE.x, GIANT_TREE.z) - 0.4, GIANT_TREE.z);
  const wood = [];
  const tips = []; // 葉叢位置 { point, radius }

  // 樹幹：底部很粗（板根），往上收，微微扭轉
  const trunkHeight = 8.2;
  const trunkCurve = new THREE.CatmullRomCurve3([
    base.clone(),
    base.clone().add(new THREE.Vector3(0.25, trunkHeight * 0.35, -0.1)),
    base.clone().add(new THREE.Vector3(-0.15, trunkHeight * 0.7, 0.15)),
    base.clone().add(new THREE.Vector3(0.1, trunkHeight, 0)),
  ]);
  wood.push(
    tube(trunkCurve, (u) => 1.75 * (1 - 0.38 * u) * (1 + 1.35 * Math.exp(-u * 8)), { segments: 30, sides: 32, bumps: 0.24, bumpSeed: 1.3 }),
  );

  // 板根：從樹幹底部往外、往下鑽進土裡
  const roots = 8;
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * TAU + range(rng, -0.25, 0.25);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const length = range(rng, 4.5, 7.5);
    const start = base.clone().add(new THREE.Vector3(dir.x * 0.9, 1.6, dir.z * 0.9));
    const points = [start];
    for (let k = 1; k <= 4; k++) {
      const t = k / 4;
      const x = base.x + dir.x * (1.4 + length * t) + range(rng, -0.3, 0.3);
      const z = base.z + dir.z * (1.4 + length * t) + range(rng, -0.3, 0.3);
      // 先貼著地面隆起，末端鑽進土裡
      points.push(new THREE.Vector3(x, groundHeight2(x, z) + 0.5 * (1 - t) - 0.25 * t * t, z));
    }
    const r0 = range(rng, 0.6, 0.85);
    wood.push(tube(new THREE.CatmullRomCurve3(points), (u) => r0 * (1 - 0.85 * u) + 0.04, { segments: 14, sides: 10 }));
  }

  // 大枝：往左右兩側與後方展開（朝鏡頭的方向少一點，樹幹才露得出來）
  const top = trunkCurve.getPointAt(1);
  const limbs = [
    { a: Math.PI * 0.97, up: 0.75, len: 12 }, // 左上
    { a: Math.PI * 0.8, up: 1.15, len: 10.5 }, // 左後偏上
    { a: 0.05, up: 0.7, len: 12.5 }, // 右上
    { a: Math.PI * 0.2, up: 1.1, len: 10.8 }, // 右後偏上
    { a: Math.PI * 0.5, up: 1.8, len: 9.5 }, // 往後、往上
    { a: Math.PI * 1.55, up: 1.0, len: 7.5 }, // 往前（短）
    { a: Math.PI * 1.25, up: 0.55, len: 10 }, // 左前，低而長
    { a: Math.PI * 1.78, up: 0.5, len: 9.8 }, // 右前，低而長
  ];
  for (const limb of limbs) {
    const dir = new THREE.Vector3(Math.cos(limb.a), limb.up, -Math.sin(limb.a));
    const start = top.clone().addScaledVector(dir.clone().setY(0).normalize(), 0.3).add(new THREE.Vector3(0, -1.2, 0));
    const curve = bentCurve(start, dir, limb.len, rng, 0.4);
    const r0 = range(rng, 0.7, 0.92);
    wood.push(tube(curve, (u) => r0 * (1 - 0.6 * u), { segments: 18, sides: 14 }));
    // 第二層：每根大枝分出 3～4 根小枝
    const branchCount = 3 + Math.floor(rng() * 2);
    for (let b = 0; b < branchCount; b++) {
      const t = range(rng, 0.45, 1.0);
      const p = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const side = new THREE.Vector3(range(rng, -1, 1), range(rng, -0.15, 0.6), range(rng, -1, 1));
      const bdir = tangent.clone().multiplyScalar(0.8).add(side).normalize();
      const blen = range(rng, 3.5, 5.5);
      const bcurve = bentCurve(p, bdir, blen, rng, 0.7);
      const br = r0 * (1 - 0.6 * t) * 0.62;
      wood.push(tube(bcurve, (u) => br * (1 - 0.75 * u) + 0.02, { segments: 8, sides: 7 }));
      // 第三層：細枝，末端長葉叢
      for (let c = 0; c < 3; c++) {
        const ct = range(rng, 0.35, 1.0);
        const cp = bcurve.getPointAt(ct);
        const cdir = bcurve.getTangentAt(ct).add(new THREE.Vector3(range(rng, -1, 1), range(rng, -0.3, 0.5), range(rng, -1, 1))).normalize();
        const clen = range(rng, 1.6, 2.8);
        const ccurve = bentCurve(cp, cdir, clen, rng, 1.0);
        wood.push(tube(ccurve, (u) => br * 0.45 * (1 - 0.8 * u) + 0.012, { segments: 5, sides: 5 }));
        tips.push({ point: ccurve.getPointAt(1), radius: range(rng, 1.7, 2.5) });
        tips.push({ point: ccurve.getPointAt(0.55), radius: range(rng, 1.3, 1.9) });
      }
      tips.push({ point: bcurve.getPointAt(1), radius: range(rng, 1.8, 2.6) });
    }
  }

  const trunkGeometry = mergeGeometries(wood);
  trunkGeometry.computeBoundingSphere();
  const trunkMaterial = createTrunkMaterial({ barkNormals });
  addMoss(trunkMaterial);
  const trunkMesh = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;

  const { geometry: foliageGeometry, crown } = buildFoliage(tips, leafBudget, rng);
  const foliageMesh = new THREE.Mesh(foliageGeometry, createFoliageMaterial({ sunWorld: sceneTwoSun }));
  foliageMesh.castShadow = true;
  foliageMesh.receiveShadow = true;

  const group = new THREE.Group();
  group.name = 'giant-tree';
  group.add(trunkMesh, foliageMesh);
  return { group, trunkMesh, foliageMesh, crown };
}

/** 樹幹材質再加一層青苔：朝上的面、低處的板根 */
function addMoss(material) {
  const original = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    original(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      /* glsl */ `{
        vec3 mossN = normalize( vBarkNormal );
        float mossUp = smoothstep( 0.1, 0.75, mossN.y );
        float mossLow = 1.0 - smoothstep( 0.6, 3.2, vBarkPosition.y );
        vec3 mp = vBarkPosition * 1.7;
        float mossNoise = fract( sin( dot( floor( mp ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ) * 0.35
          + 0.65 * ( 0.5 + 0.5 * sin( mp.x * 1.3 + sin( mp.z * 1.7 ) + mp.y * 0.6 ) );
        float mossMask = smoothstep( 0.5, 0.85, mossNoise * ( mossUp * 0.8 + mossLow * 0.7 ) );
        // 老樹皮偏深；青苔在板根與朝上的面
        diffuseColor.rgb *= 0.62;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.1, 0.14, 0.04 ), mossMask * 0.85 );
      }
      #include <roughnessmap_fragment>`,
    );
  };
  material.customProgramCacheKey = () => 'giant-bark';
}

/** 葉叢：每個 tip 一團小楓葉，越深入樹冠、越靠葉叢內側越暗 */
function buildFoliage(tips, budget, rng) {
  const crown = new THREE.Vector3();
  tips.forEach((t) => crown.add(t.point));
  crown.divideScalar(tips.length);
  let crownRadius = 0;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const t of tips) {
    crownRadius = Math.max(crownRadius, t.point.distanceTo(crown) + t.radius);
    yMin = Math.min(yMin, t.point.y - t.radius);
    yMax = Math.max(yMax, t.point.y + t.radius);
  }
  const perTip = Math.max(30, Math.floor(budget / tips.length));
  const vertsPerLeaf = LEAF.length + 1;
  const total = perTip * tips.length;
  const position = new Float32Array(total * vertsPerLeaf * 3);
  const normal = new Float32Array(total * vertsPerLeaf * 3);
  const color = new Float32Array(total * vertsPerLeaf * 3);
  const ao = new Float32Array(total * vertsPerLeaf);
  const crownAttr = new Float32Array(total * vertsPerLeaf * 3);
  const index = new Uint32Array(total * LEAF.length * 3);

  const dir = new THREE.Vector3();
  const n = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const right = new THREE.Vector3();
  const hang = new THREE.Vector3();
  const center = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const c = new THREE.Color();
  const randomUnit = (target) => {
    const z = range(rng, -1, 1);
    const a = rng() * TAU;
    const r = Math.sqrt(1 - z * z);
    return target.set(r * Math.cos(a), z, r * Math.sin(a));
  };
  let v = 0;
  let k = 0;
  const push = (p, col, aoValue) => {
    position.set([p.x, p.y, p.z], v * 3);
    normal.set([n.x, n.y, n.z], v * 3);
    color.set([col.r, col.g, col.b], v * 3);
    ao[v] = aoValue;
    crownAttr.set([offset.x, offset.y, offset.z], v * 3);
    return v++;
  };
  for (const t of tips) {
    for (let i = 0; i < perTip; i++) {
      randomUnit(dir);
      if (dir.y < -0.5) dir.y *= -0.3;
      dir.normalize();
      const radial = Math.sqrt(range(rng, 0.05, 1)) * range(rng, 0.85, 1.1);
      center.copy(t.point).addScaledVector(dir, t.radius * radial);
      center.y -= t.radius * 0.15 * radial;
      const size = range(rng, 0.28, 0.42);
      randomUnit(n).multiplyScalar(0.6).add(dir).normalize();
      randomUnit(hang).multiplyScalar(0.6).add(corner.set(0, -1, 0));
      tip.copy(hang).addScaledVector(n, -hang.dot(n));
      if (tip.lengthSq() < 1e-6) tip.set(1, 0, 0).cross(n);
      tip.normalize();
      right.crossVectors(tip, n);

      // AO：在樹冠裡的深度、在葉叢裡的位置、高度
      const depth = center.distanceTo(crown) / crownRadius;
      const height = THREE.MathUtils.clamp((center.y - yMin) / (yMax - yMin), 0, 1);
      let a = 0.12 + 0.88 * THREE.MathUtils.smoothstep(depth, 0.2, 0.9);
      a *= 0.5 + 0.5 * THREE.MathUtils.smoothstep(radial, 0.3, 1.0);
      a *= 0.7 + 0.3 * height;
      a = THREE.MathUtils.clamp(a, 0.08, 1);
      offset.subVectors(center, crown).divideScalar(crownRadius);

      c.setHex(giantHue(rng));
      const hsl = {};
      c.getHSL(hsl);
      c.setHSL(hsl.h + range(rng, -0.012, 0.012), Math.min(1, hsl.s * range(rng, 0.9, 1.1)), hsl.l * range(rng, 0.85, 1.1));
      const baseVertex = push(corner.copy(center).addScaledVector(n, -size * 0.1), c.clone().multiplyScalar(0.8), a);
      for (const [x, y] of LEAF) {
        corner.copy(center).addScaledVector(right, x * size).addScaledVector(tip, y * size);
        push(corner, c, a);
      }
      for (let j = 0; j < LEAF.length; j++) {
        index[k++] = baseVertex;
        index[k++] = baseVertex + 1 + j;
        index[k++] = baseVertex + 1 + ((j + 1) % LEAF.length);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setAttribute('aAo', new THREE.BufferAttribute(ao, 1));
  geometry.setAttribute('aCrown', new THREE.BufferAttribute(crownAttr, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return { geometry, crown: { center: crown, radius: crownRadius } };
}
