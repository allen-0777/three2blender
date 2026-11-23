import * as THREE from 'three';
import { pickLeafHue, range } from './palette.js';
import { groundHeight, groundNormal } from './environment.js';
import { leafTransmission } from './leafShading.js';

// 飄落範圍（世界座標）。zMax 離鏡頭（z = 12）留兩公尺以上，
// 避免葉子貼著鏡頭飄過、在景深裡變成一大團色塊。
const AREA = { xMin: -17, xMax: 17, zMin: -32, zMax: 9.5, top: 12 };
const TAU = Math.PI * 2;

// 五裂楓葉輪廓的右半邊（葉柄朝下，整體約 1 單位大），左半邊鏡射
const HALF_OUTLINE = [
  [0.02, -0.5], [0.02, -0.3], [0.25, -0.36], [0.2, -0.22], [0.5, -0.02],
  [0.4, 0.03], [0.47, 0.2], [0.3, 0.17], [0.27, 0.25], [0.14, 0.12],
  [0.2, 0.42], [0.1, 0.36], [0, 0.52],
];
// 葉脈匯集處（葉柄接葉身的位置）
const VEIN_BASE = [0, -0.28];

/** 完整輪廓（逆時針），許願楓葉的邊緣光用（wishLeaves.js） */
export const LEAF_OUTLINE = [
  ...HALF_OUTLINE,
  ...HALF_OUTLINE.slice(0, -1).reverse().map(([x, y]) => [-x, y]),
];
export const LEAF_VEIN_BASE = VEIN_BASE;

/** 平面輪廓：許願楓葉用（wishLeaves.js） */
function createFlatLeafGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(HALF_OUTLINE[0][0], HALF_OUTLINE[0][1]);
  for (let i = 1; i < HALF_OUTLINE.length; i++) shape.lineTo(HALF_OUTLINE[i][0], HALF_OUTLINE[i][1]);
  for (let i = HALF_OUTLINE.length - 2; i >= 0; i--) shape.lineTo(-HALF_OUTLINE[i][0], HALF_OUTLINE[i][1]);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/**
 * 一般落葉用的立體葉片：同一個輪廓，但沿中肋對折、葉尖微捲。
 * 以葉脈匯集處為中心做扇形三角化（輪廓對該點是星形），中肋上才有頂點可以折。
 */
function createBentLeafGeometry() {
  const bend = (x, y) => Math.abs(x) * 0.34 - 0.2 * (y + 0.05) ** 2 - 0.035;
  const positions = [VEIN_BASE[0], VEIN_BASE[1], bend(...VEIN_BASE)];
  const push = (x, y) => positions.push(x, y, bend(x, y)) / 3 - 1;
  const right = HALF_OUTLINE.map(([x, y]) => push(x, y));
  // 中肋上（x = 0）的葉尖左右共用同一個頂點
  const left = HALF_OUTLINE.map(([x, y], i) => (x === 0 ? right[i] : push(-x, y)));

  const index = [];
  for (let i = 0; i < right.length - 1; i++) {
    index.push(0, right[i], right[i + 1]);
    index.push(0, left[i + 1], left[i]);
  }
  index.push(0, left[0], right[0]); // 葉柄底部

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

// 許願楓葉（wishLeaves.js）共用同一份輪廓，但材質與光暈邏輯各自獨立
export const leafGeometry = createFlatLeafGeometry();
export const bentLeafGeometry = createBentLeafGeometry();

/**
 * 一般落葉的材質：正面／背面色差、程序化葉脈、跟著太陽的透光。
 * 沒有 emissive：背光且在陰影裡的葉子就是暗的，只有許願葉會自己發光。
 */
function createLeafMaterial() {
  // 粗糙度高、不反光：去掉塑膠感
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide });
  const transmission = leafTransmission({ transmit: 0.85, forward: 2.2 });
  material.onBeforeCompile = (shader) => {
    transmission(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLeafUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLeafUv = position.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec2 vLeafUv;
        float leafSegment( vec2 p, vec2 a, vec2 b ) {
          vec2 pa = p - a, ba = b - a;
          return length( pa - ba * clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 ) );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          // 葉脈：中肋 + 三對側脈，從葉柄接點放射到各裂片尖端
          vec2 leafP = vec2( abs( vLeafUv.x ), vLeafUv.y );
          const vec2 base = vec2( ${VEIN_BASE[0].toFixed(2)}, ${VEIN_BASE[1].toFixed(2)} );
          float vein = min( leafSegment( leafP, vec2( 0.0, -0.5 ), vec2( 0.0, 0.5 ) ) * 0.7,
            min( leafSegment( leafP, base, vec2( 0.45, 0.19 ) ),
            min( leafSegment( leafP, base, vec2( 0.47, -0.03 ) ),
                 leafSegment( leafP, base, vec2( 0.19, 0.4 ) ) ) ) );
          float veinWidth = max( 0.011, fwidth( vein ) );
          // 葉子在畫面上很小時葉脈淡出，避免閃爍
          float veinMask = ( 1.0 - smoothstep( 0.0, veinWidth, vein ) ) * saturate( 0.02 / max( fwidth( vein ), 0.0001 ) );
          if ( gl_FrontFacing ) {
            diffuseColor.rgb *= mix( 1.0, 0.72, veinMask );
          } else {
            // 背面較淡、較不飽和，葉脈反而凸起偏亮
            float lum = dot( diffuseColor.rgb, vec3( 0.3, 0.55, 0.15 ) );
            diffuseColor.rgb = mix( diffuseColor.rgb, vec3( lum ) * vec3( 1.12, 1.0, 0.82 ), 0.42 ) * 1.08;
            diffuseColor.rgb *= mix( 1.0, 1.22, veinMask );
          }
        }`,
      );
  };
  return material;
}

const leafMaterial = createLeafMaterial();

function createLeafMesh(count, rng) {
  const mesh = new THREE.InstancedMesh(bentLeafGeometry, leafMaterial, count);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    color.setHex(pickLeafHue(rng)).multiplyScalar(range(rng, 0.8, 1.1));
    mesh.setColorAt(i, color);
  }
  mesh.instanceColor.needsUpdate = true;
  // 實例分布範圍大，關閉以單一包圍球為準的視錐剔除
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * 飄落的楓葉。回傳 { mesh, update(dt, time), setCount(n) }。
 * 每片葉子有固定的亂數種子值；翻轉角與側向滑移耦合：
 * 葉面越接近直立（側緣朝下）滑得越快、也掉得越快，平躺時像降落傘一樣慢。
 * speedScale 用於 prefers-reduced-motion 時放慢。
 */
export function createFallingLeaves({ count, rng, speedScale = 1 }) {
  const mesh = createLeafMesh(count, rng);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const spawn = (leaf, y) => {
    leaf.x = range(rng, AREA.xMin, AREA.xMax);
    leaf.z = range(rng, AREA.zMin, AREA.zMax);
    leaf.y = y;
    leaf.age = 0;
  };

  const leaves = Array.from({ length: count }, () => {
    const tumbling = rng() < 0.4;
    const leaf = {
      // 40% 整圈翻滾，其餘左右擺盪
      tumbling,
      omega: (rng() < 0.5 ? -1 : 1) * (tumbling ? range(rng, 1.4, 3.2) : range(rng, 1.1, 2.4)),
      swing: range(rng, 0.5, 1.15),
      angle: rng() * TAU,
      heading: rng() * TAU,
      headingDrift: range(rng, -0.35, 0.35),
      roll: rng() * TAU,
      rollRate: range(rng, -0.7, 0.7),
      fall: range(rng, 0.42, 0.95),
      slip: range(rng, 0.5, 1.5),
      windResponse: range(rng, 0.7, 1.3),
      // 第二輪：裝飾落葉變小、大小不一（多數小葉，少數大葉），讓發光的許願葉一眼就分得出來
      scale: 0.07 + 0.2 * rng() ** 1.7,
      x: 0,
      y: 0,
      z: 0,
      age: 10,
    };
    spawn(leaf, range(rng, 0, AREA.top));
    leaf.age = 10; // 一開始就在空中的葉子不需要淡入
    return leaf;
  });

  const dummy = new THREE.Object3D();
  dummy.rotation.order = 'YXZ';
  const width = AREA.xMax - AREA.xMin;

  function update(dt, time) {
    const step = dt * speedScale;
    // 共用的風：緩慢陣風，每片葉子的受風程度略有不同
    const windX = 0.32 + Math.sin(time * 0.2) * 0.24 + Math.sin(time * 0.53 + 1.7) * 0.08;
    const windZ = Math.sin(time * 0.13 + 0.6) * 0.1;

    for (let i = 0; i < mesh.count; i++) {
      const leaf = leaves[i];
      leaf.angle += leaf.omega * step;
      leaf.heading += leaf.headingDrift * step;
      leaf.roll += leaf.rollRate * step;
      leaf.age += step;

      // tilt = 0 時葉面朝上平躺，±90° 時直立
      const tilt = leaf.tumbling ? leaf.angle : Math.sin(leaf.angle) * leaf.swing;
      const edge = Math.sin(tilt);
      const slide = leaf.slip * edge * step;
      leaf.x += Math.sin(leaf.heading) * slide + windX * leaf.windResponse * step;
      leaf.z += Math.cos(leaf.heading) * slide + windZ * leaf.windResponse * step;
      leaf.y -= leaf.fall * (0.7 + 0.6 * edge * edge) * step;

      if (leaf.x > AREA.xMax) leaf.x -= width;
      else if (leaf.x < AREA.xMin) leaf.x += width;
      if (leaf.y < groundHeight(leaf.x, leaf.z) + 0.04) spawn(leaf, AREA.top + rng() * 3);

      // 在邊界與剛出現時縮小，把循環的跳動藏起來
      const edgeFade = Math.min(1, (leaf.x - AREA.xMin) / 1.5, (AREA.xMax - leaf.x) / 1.5);
      const fade = Math.max(0, Math.min(edgeFade, leaf.age / 0.8, 1));

      dummy.position.set(leaf.x, leaf.y, leaf.z);
      dummy.rotation.set(tilt - Math.PI / 2, leaf.heading, leaf.roll);
      dummy.scale.setScalar(leaf.scale * fade);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(0, 0);
  return {
    mesh,
    update,
    /** 畫質分級調整份量（不重新配置，只改實際繪製與更新的數量） */
    setCount(next) {
      mesh.count = Math.max(0, Math.min(count, Math.round(next)));
    },
  };
}

/**
 * 地上落葉成堆的位置：樹根周圍、小徑兩側的邊緣，以及零星幾處。
 * trees：[{ x, z, scale }]。回傳 [{ x, z, radius, amount }]，地面貼圖（environment.js）與落葉配置共用。
 */
export function createLitterSpots({ trees, rng }) {
  const spots = [];
  const inArea = (x, z) => x > AREA.xMin - 4 && x < AREA.xMax + 4 && z > AREA.zMin - 6 && z < AREA.zMax + 4;
  for (const tree of trees) {
    const piles = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < piles; i++) {
      const angle = rng() * TAU;
      const distance = range(rng, 0.4, 2.2) * tree.scale;
      const x = tree.x + Math.cos(angle) * distance;
      const z = tree.z + Math.sin(angle) * distance;
      if (inArea(x, z)) spots.push({ x, z, radius: range(rng, 0.45, 1.2), amount: range(rng, 0.6, 1) });
    }
  }
  // 小徑邊緣被踢到兩側堆起來
  for (let z = AREA.zMin; z < AREA.zMax + 3; z += range(rng, 1.6, 3.2)) {
    const side = rng() < 0.5 ? -1 : 1;
    spots.push({ x: side * range(rng, 1.5, 3.0), z, radius: range(rng, 0.35, 0.9), amount: range(rng, 0.5, 0.9) });
  }
  for (let i = 0; i < 14; i++) {
    spots.push({
      x: range(rng, AREA.xMin, AREA.xMax),
      z: range(rng, AREA.zMin, AREA.zMax),
      radius: range(rng, 0.4, 1.0),
      amount: range(rng, 0.4, 0.8),
    });
  }
  return spots;
}

/** 正規分布亂數（Box–Muller） */
const gaussian = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(TAU * rng());

/**
 * 靜止鋪在地面的落葉：貼著地表高度與法線，不懸空。
 * 約八成堆在 spots（成堆成簇、彼此交疊），其餘零星散落。
 */
export function createGroundLeaves({ count, rng, spots = [] }) {
  const mesh = createLeafMesh(count, rng);
  mesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const normal = new THREE.Vector3();
  const up = new THREE.Vector3(0, 0, 1); // 葉片幾何的法線方向
  const align = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const weights = spots.map((spot) => spot.radius * spot.radius * spot.amount);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const pickSpot = () => {
    let r = rng() * totalWeight;
    for (let i = 0; i < spots.length; i++) {
      r -= weights[i];
      if (r <= 0) return spots[i];
    }
    return spots[spots.length - 1];
  };

  for (let i = 0; i < count; i++) {
    let x;
    let z;
    let pile = 0;
    if (spots.length > 0 && rng() < 0.8) {
      const spot = pickSpot();
      const gx = gaussian(rng) * spot.radius * 0.5;
      const gz = gaussian(rng) * spot.radius * 0.5;
      x = spot.x + gx;
      z = spot.z + gz;
      // 堆的中央疊得比較厚
      pile = Math.exp(-(gx * gx + gz * gz) / (2 * (spot.radius * 0.5) ** 2)) * spot.amount;
    } else {
      x = range(rng, AREA.xMin - 4, AREA.xMax + 4);
      z = range(rng, AREA.zMin - 6, AREA.zMax + 4);
    }
    const scale = 0.09 + 0.18 * rng() ** 1.4;
    groundNormal(x, z, normal);
    // 葉片中央對折後最低點在中肋，抬高一點點讓邊緣翹起、中肋貼地；堆裡的葉子疊高一些
    dummy.position.set(x, groundHeight(x, z) + scale * range(rng, 0.04, 0.1) + pile * range(rng, 0, 0.09), z);

    align.setFromUnitVectors(up, normal);
    spin.setFromAxisAngle(up, rng() * TAU);
    // 少數葉子翻面（露出較淡的背面），其餘只有些微歪斜；堆裡的葉子歪得多
    const flipped = rng() < 0.3;
    axis.set(rng() - 0.5, rng() - 0.5, 0).normalize();
    tilt.setFromAxisAngle(axis, (flipped ? Math.PI : 0) + range(rng, -0.22, 0.22) * (1 + pile * 2));
    dummy.quaternion.copy(align).multiply(spin).multiply(tilt);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
