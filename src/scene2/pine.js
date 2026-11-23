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

/**
 * 針葉簇：每簇是一個放射狀的星形（中心 + 16 個尖角），大致朝上、朝外，散在雲片的上表面與邊緣。
 * 輸出的屬性與楓樹冠相同（position、normal、color、aAo、aCrown），共用樹冠材質（透光、AO）。
 */
function needleTufts(center, radius, rng, out) {
  const count = Math.round(70 * radius * radius + 24);
  const n = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const right = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    const a = rng() * TAU;
    const d = Math.sqrt(rng()) * radius * 1.02;
    const edge = d / radius;
    // 上表面是圓頂，邊緣往下垂一點
    c.set(center.x + Math.cos(a) * d, center.y + (1 - edge * edge) * radius * 0.32 + range(rng, -0.08, 0.12) - edge * 0.12, center.z + Math.sin(a) * d);
    n.set(Math.cos(a) * edge * 0.8 + range(rng, -0.3, 0.3), 1.0, Math.sin(a) * edge * 0.8 + range(rng, -0.3, 0.3)).normalize();
    tip.set(range(rng, -1, 1), 0, range(rng, -1, 1)).addScaledVector(n, -0.0);
    tip.addScaledVector(n, -tip.dot(n));
    if (tip.lengthSq() < 1e-4) tip.set(1, 0, 0);
    tip.normalize();
    right.crossVectors(tip, n);
    const size = range(rng, 0.2, 0.3);
    const ao = 0.35 + 0.65 * THREE.MathUtils.smoothstep(edge, 0.2, 1.0) * (0.7 + 0.3 * rng());
    const light = range(rng, 0.8, 1.15);
    const col = [0.045 * light, 0.085 * light, 0.035 * light];
    const base = out.position.length / 3;
    const push = (x, y, z, scale) => {
      out.position.push(x, y, z);
      out.normal.push(n.x, n.y, n.z);
      out.color.push(col[0] * scale, col[1] * scale, col[2] * scale);
      out.ao.push(ao);
      out.crown.push(Math.cos(a) * edge, 0.3, Math.sin(a) * edge);
    };
    push(c.x, c.y, c.z, 0.7);
    const spikes = 16;
    for (let i = 0; i < spikes; i++) {
      const t = (i / spikes) * TAU;
      const r = (i % 2 === 0 ? 1 : 0.28) * size;
      p.copy(c).addScaledVector(right, Math.cos(t) * r).addScaledVector(tip, Math.sin(t) * r);
      push(p.x, p.y, p.z, 1);
    }
    for (let i = 0; i < spikes; i++) out.index.push(base, base + 1 + i, base + 1 + ((i + 1) % spikes));
  }
}

/** 一棵黑松（樹的座標原點在根部，之後由呼叫端放到地面） */
function buildPine(rng, height, needles) {
  const parts = [];
  const lean = range(rng, -0.6, 0.6);
  const points = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    // 黑松的樹幹扭曲、斜生：沿高度左右擺兩次
    points.push(new THREE.Vector3(Math.sin(t * 3.4 + lean) * 0.9 * t + lean * t * 1.6, t * height, Math.cos(t * 2.6 + lean) * 0.6 * t - 0.3 * t));
  }
  const trunk = new THREE.CatmullRomCurve3(points);
  parts.push(tube(trunk, 0.34, 0.09, 18, 10));
  // 枝：從樹幹上段長出，幾乎水平，末端一片雲
  const tiers = 4 + Math.floor(rng() * 2);
  for (let k = 0; k < tiers; k++) {
    const t = 0.34 + (k / tiers) * 0.62;
    const start = trunk.getPointAt(t);
    const a = rng() * TAU;
    const length = (1 - t) * range(rng, 2.2, 3.2) + 0.5;
    const dir = new THREE.Vector3(Math.cos(a), range(rng, -0.05, 0.25), Math.sin(a)).normalize();
    const end = start.clone().addScaledVector(dir, length);
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, range(rng, -0.15, 0.2), 0));
    parts.push(tube(new THREE.CatmullRomCurve3([start, mid, end]), 0.07, 0.03, 6, 5));
    const radius = (1 - t) * 1.4 + range(rng, 0.5, 0.75);
    const padCenter = end.clone().add(new THREE.Vector3(0, 0.15, 0));
    // 暗色的實心核心（填滿針葉簇之間的縫）＋ 外層的針葉簇
    parts.push(pad(padCenter, radius * 0.78, rng));
    needleTufts(padCenter, radius, rng, needles);
    if (rng() < 0.6) {
      const second = start.clone().lerp(end, 0.45).add(new THREE.Vector3(0, 0.3, 0));
      parts.push(pad(second, radius * 0.5, rng));
      needleTufts(second, radius * 0.62, rng, needles);
    }
  }
  // 樹頂
  const crownTop = trunk.getPointAt(1).add(new THREE.Vector3(0, 0.2, 0));
  const topRadius = range(rng, 0.8, 1.1);
  parts.push(pad(crownTop, topRadius * 0.78, rng));
  needleTufts(crownTop, topRadius, rng, needles);
  return mergeGeometries(parts);
}

/** placements：[{ x, z, height, rotation }]，回傳 Group */
export function createPines(placements, needleMaterial) {
  const rng = createRng(8086);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const group = new THREE.Group();
  group.name = 'pines';
  for (const p of placements) {
    const needles = { position: [], normal: [], color: [], ao: [], crown: [], index: [] };
    const wood = new THREE.Mesh(buildPine(rng, p.height, needles), material);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(needles.position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(needles.normal, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(needles.color, 3));
    g.setAttribute('aAo', new THREE.Float32BufferAttribute(needles.ao, 1));
    g.setAttribute('aCrown', new THREE.Float32BufferAttribute(needles.crown, 3));
    g.setIndex(needles.index);
    g.computeBoundingSphere();
    const tree = new THREE.Group();
    tree.add(wood, new THREE.Mesh(g, needleMaterial));
    tree.position.set(p.x, groundHeight2(p.x, p.z) - 0.05, p.z);
    tree.rotation.y = p.rotation ?? rng() * TAU;
    tree.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    group.add(tree);
  }
  return group;
}
