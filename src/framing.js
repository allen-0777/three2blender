import * as THREE from 'three';
import { createRng, range } from './palette.js';
import { bentLeafGeometry } from './leaves.js';
import { FOREGROUND_LAYER } from './post.js';

// 前景框景：畫面右上角一根很近的楓枝（約 1.5 公尺），逆光下偏暗、少數葉子透紅。
// 它在獨立的前景層（post.js 的 FOREGROUND_LAYER）畫成不受光的剪影，再整層高斯模糊，
// 像大光圈下對不到焦的前景。掛在鏡頭底下跟著鏡頭走，
// 只佔右上角（畫面座標 x > KEEP_OUT.x、y > KEEP_OUT.y），不擋中間的標題、按鈕與許願葉。

const DISTANCE = 1.5;
/** 右上角被樹枝佔用的範圍（以畫面中心為 0、邊緣為 1 的座標），許願葉會避開 */
export const KEEP_OUT = { x: 0.52, y: 0.5 };

/** 錐狀枝條：沿曲線放一圈圈頂點，半徑由 r0 漸細到 r1 */
function taperedTube(curve, r0, r1, segments = 24, sides = 7) {
  const frames = curve.computeFrenetFrames(segments, false);
  const positions = [];
  const normals = [];
  const index = [];
  const point = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    curve.getPointAt(u, point);
    const r = r0 + (r1 - r0) * u;
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      positions.push(point.x + n.x * r, point.y + n.y * r, point.z + n.z * r);
      normals.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j;
      const b = i * sides + ((j + 1) % sides);
      index.push(a, a + sides, b, b, a + sides, b + sides);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(index);
  return geometry;
}

/**
 * 在「樹枝座標」裡建模：原點是枝條從畫面外伸進來的位置，枝條往 -x（畫面內側）、略往下長，
 * 長度約 1 單位；layout() 依視角把整根縮放到右上角。
 */
function buildBranch() {
  const rng = createRng(4242);
  const group = new THREE.Group();
  // 逆光剪影：不受光，顏色直接是線性 HDR 值（很暗的樹皮）
  const barkMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.012, 0.007, 0.005), fog: false });
  const main = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.25, 0.12, 0),
    new THREE.Vector3(-0.15, 0.0, 0.02),
    new THREE.Vector3(-0.55, -0.14, -0.03),
    new THREE.Vector3(-0.95, -0.2, 0.02),
  ]);
  const curves = [{ curve: main, r0: 0.028, r1: 0.008 }];
  // 細枝：從主枝分出去，往下垂
  for (const [t, dx, dy] of [
    [0.3, -0.18, -0.24],
    [0.48, -0.08, 0.16],
    [0.62, -0.2, -0.3],
    [0.8, -0.16, 0.1],
  ]) {
    const start = main.getPointAt(t);
    curves.push({
      curve: new THREE.CatmullRomCurve3([
        start,
        start.clone().add(new THREE.Vector3(dx * 0.5, dy * 0.45, range(rng, -0.05, 0.05))),
        start.clone().add(new THREE.Vector3(dx, dy, range(rng, -0.06, 0.06))),
      ]),
      r0: 0.008,
      r1: 0.003,
    });
  }
  for (const { curve, r0, r1 } of curves) {
    const mesh = new THREE.Mesh(taperedTube(curve, r0, r1), barkMaterial);
    group.add(mesh);
  }

  // 葉子：沿每根細枝的後半段與主枝末端成簇長出，葉面大致朝鏡頭、葉尖下垂
  const leafMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false });
  const spots = [];
  curves.forEach(({ curve }, i) => {
    const leaves = i === 0 ? 7 : 6;
    for (let k = 0; k < leaves; k++) spots.push(curve.getPointAt(i === 0 ? range(rng, 0.55, 1) : range(rng, 0.35, 1)));
  });
  const leaves = new THREE.InstancedMesh(bentLeafGeometry, leafMaterial, spots.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  spots.forEach((p, i) => {
    dummy.position.copy(p).add(new THREE.Vector3(range(rng, -0.04, 0.04), range(rng, -0.08, 0.0), range(rng, -0.04, 0.04)));
    // 葉尖朝下（幾何的葉尖是 +y），對著鏡頭（+z）微傾
    dummy.rotation.set(range(rng, -0.7, 0.5), range(rng, -0.8, 0.8), Math.PI + range(rng, -0.7, 0.7));
    dummy.scale.setScalar(range(rng, 0.13, 0.19));
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
    // 大多是逆光裡的暗紅剪影，約三成被太陽從背後透亮成朱紅
    if (rng() < 0.3) color.setRGB(range(rng, 0.32, 0.55), range(rng, 0.04, 0.08), 0.012);
    else color.setRGB(range(rng, 0.045, 0.09), 0.01, 0.006);
    leaves.setColorAt(i, color);
  });
  leaves.instanceMatrix.needsUpdate = true;
  leaves.instanceColor.needsUpdate = true;
  group.add(leaves);

  group.traverse((child) => {
    child.layers.set(FOREGROUND_LAYER);
    child.castShadow = false;
    child.receiveShadow = false;
    child.frustumCulled = false;
  });
  return group;
}

/** 回傳 { group（要 add 到 camera 底下）, layout(camera) } */
export function createFraming() {
  const branch = buildBranch();
  const group = new THREE.Group();
  group.add(branch);
  group.name = 'foreground-branch';
  let baseX = 0;
  let baseY = 0;
  let unit = 1;
  return {
    group,
    /** 微風裡輕輕晃動；滑鼠視差時比背景多移一點（它離鏡頭最近） */
    update(time, pointer, still = false) {
      const sway = still ? 0 : Math.sin(time * 0.7) * 0.025 + Math.sin(time * 1.9 + 1.3) * 0.008;
      branch.rotation.z = -0.12 + sway;
      branch.position.x = baseX - pointer.x * unit * 0.05;
      branch.position.y = baseY - pointer.y * unit * 0.035;
    },
    layout(camera) {
      const halfHeight = DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const halfWidth = halfHeight * camera.aspect;
      // 整根樹枝約佔畫面寬度的 22%（直式畫面改用高度為準，免得太細小）
      const scale = Math.max(halfWidth * 0.6, halfHeight * 0.5);
      branch.scale.setScalar(scale);
      baseX = halfWidth * 1.0;
      baseY = halfHeight * 0.92;
      unit = halfHeight;
      branch.position.set(baseX, baseY, -DISTANCE);
      branch.rotation.set(0, 0, -0.12);
    },
  };
}
