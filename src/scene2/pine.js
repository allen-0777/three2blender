import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, range } from '../palette.js';
import { groundHeight2 } from './terrain.js';

// 黑松：日式庭園裡修剪成「雲片」的松樹。彎曲的深色樹幹、幾根近乎水平的枝，
// 枝端是一片片扁平的針葉團（上面受光、下面很暗）。給楓紅畫面一點深色的對比。
// 程式生成；每棵樹一個網格（棵數很少）。

const TAU = Math.PI * 2;

function tube(curve, r0, r1, segments = 12, sides = 8) {
  const frames = curve.computeFrenetFrames(segments, false);
  const positions = [];
  const colors = [];
  const index = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    curve.getPointAt(u, p);
    const r = r0 + (r1 - r0) * u;
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * TAU;
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      const plate = 1 + 0.06 * Math.sin(a * 3 + u * 20); // 松樹皮的龜甲狀起伏
      positions.push(p.x + n.x * r * plate, p.y + n.y * r * plate, p.z + n.z * r * plate);
      colors.push(0.16, 0.11, 0.08);
    }
  }
  const ring = sides + 1;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * ring + j;
      index.push(a, a + ring, a + 1, a + 1, a + ring, a + ring + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/**
 * 一片雲狀針葉團：一群壓扁的小團塊聚成扁平的一片（上面圓、底部平），
 * 表面細碎擾動讓輪廓毛茸茸的；頂點色上面略亮、下面很暗。
 */
function pad(center, radius, rng) {
  const parts = [];
  const blobs = 9 + Math.floor(radius * 8);
  const v = new THREE.Vector3();
  for (let b = 0; b < blobs; b++) {
    const a = rng() * TAU;
    const d = Math.sqrt(rng()) * radius * 0.78;
    const r = radius * range(rng, 0.34, 0.5) * (1 - 0.3 * (d / radius));
    const cx = center.x + Math.cos(a) * d;
    const cz = center.z + Math.sin(a) * d;
    const cy = center.y + range(rng, -0.05, 0.12) * radius + (1 - d / radius) * radius * 0.12;
    const g = new THREE.IcosahedronGeometry(1, 2);
    const pos = g.attributes.position;
    const colors = [];
    const seed = rng() * 10;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const top = v.y;
      // 針葉的毛邊：高頻擾動
      const fuzz = 1 + 0.18 * Math.sin(v.x * 13 + seed) * Math.sin(v.z * 11 - seed) + 0.12 * Math.sin(v.y * 17 + v.x * 9);
      v.multiplyScalar(fuzz);
      v.set(v.x * r, (top > 0 ? v.y * 0.72 : v.y * 0.32) * r, v.z * r);
      pos.setXYZ(i, v.x + cx, v.y + cy, v.z + cz);
      const light = top > 0 ? 0.7 + 0.45 * top : 0.3 + 0.35 * (1 + top);
      colors.push(0.035 * light, 0.07 * light, 0.032 * light);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    parts.push(g);
  }
  return mergeGeometries(parts);
}

/** 一棵黑松（樹的座標原點在根部，之後由呼叫端放到地面） */
function buildPine(rng, height) {
  const parts = [];
  const lean = range(rng, -0.6, 0.6);
  const points = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    points.push(new THREE.Vector3(Math.sin(t * 2.2 + lean) * 0.5 * t + lean * t * 0.8, t * height, Math.cos(t * 1.7) * 0.25 * t));
  }
  const trunk = new THREE.CatmullRomCurve3(points);
  parts.push(tube(trunk, 0.24, 0.07, 16, 9));
  // 枝：從樹幹上段長出，幾乎水平，末端一片雲
  const tiers = 4 + Math.floor(rng() * 2);
  for (let k = 0; k < tiers; k++) {
    const t = 0.42 + (k / tiers) * 0.55;
    const start = trunk.getPointAt(t);
    const a = rng() * TAU;
    const length = (1 - t) * range(rng, 2.2, 3.2) + 0.5;
    const dir = new THREE.Vector3(Math.cos(a), range(rng, -0.05, 0.25), Math.sin(a)).normalize();
    const end = start.clone().addScaledVector(dir, length);
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, range(rng, -0.15, 0.2), 0));
    parts.push(tube(new THREE.CatmullRomCurve3([start, mid, end]), 0.07, 0.03, 6, 5));
    const radius = (1 - t) * 1.4 + range(rng, 0.5, 0.75);
    parts.push(pad(end.clone().add(new THREE.Vector3(0, 0.15, 0)), radius, rng));
    if (rng() < 0.6) parts.push(pad(start.clone().lerp(end, 0.45).add(new THREE.Vector3(0, 0.3, 0)), radius * 0.6, rng));
  }
  // 樹頂
  parts.push(pad(trunk.getPointAt(1).add(new THREE.Vector3(0, 0.2, 0)), range(rng, 0.8, 1.1), rng));
  return mergeGeometries(parts);
}

/** placements：[{ x, z, height, rotation }]，回傳 Group */
export function createPines(placements) {
  const rng = createRng(8086);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const group = new THREE.Group();
  group.name = 'pines';
  for (const p of placements) {
    const mesh = new THREE.Mesh(buildPine(rng, p.height), material);
    mesh.position.set(p.x, groundHeight2(p.x, p.z) - 0.05, p.z);
    mesh.rotation.y = p.rotation ?? rng() * TAU;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
