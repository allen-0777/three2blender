import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, range } from '../palette.js';
import { createWoodMaterial } from './materials.js';
import { BRIDGE, WATER_LEVEL, groundHeight2 } from './terrain.js';

// 簡單的木橋：微拱的橋面（一片片橫向木板）、兩根縱樑、兩側欄杆（柱 + 上下兩道橫桿）、
// 插進溪裡的橋墩。全部合併成一個網格，一個木頭材質。

/** 橋面在 z 處的高度（兩端落在岸上，中間拱起） */
export function bridgeDeckHeight(z) {
  const t = (z - BRIDGE.z) / ((BRIDGE.zNear - BRIDGE.zFar) / 2);
  const ends = Math.max(groundHeight2(BRIDGE.x, BRIDGE.zNear), groundHeight2(BRIDGE.x, BRIDGE.zFar));
  return ends + 0.08 + BRIDGE.rise * (1 - t * t);
}

/** 沿兩點之間放一根方木（box），長軸對齊兩點 */
function beam(a, b, width, height, tint, rng) {
  const length = a.distanceTo(b);
  const g = new THREE.BoxGeometry(width, height, length).toNonIndexed();
  g.deleteAttribute('uv');
  const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  g.applyMatrix4(m);
  colorize(g, tint, rng);
  return g;
}

function box(w, h, d, x, y, z, tint, rng, rotY = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.deleteAttribute('uv');
  g.rotateY(rotY);
  g.translate(x, y, z);
  colorize(g, tint, rng);
  return g;
}

/** 每根木料一個略有差異的顏色（舊木頭有深有淺） */
function colorize(geometry, tint, rng) {
  const c = new THREE.Color(tint).multiplyScalar(range(rng, 0.75, 1.15));
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export function createBridge() {
  const rng = createRng(5150);
  const parts = [];
  const { x, zNear, zFar, width } = BRIDGE;
  const plank = 0xb08a68;
  const frame = 0x8f6c4e;

  // 橋面木板（沿 z 排列，每片橫跨 x）
  const plankDepth = 0.2;
  for (let z = zNear; z > zFar; z -= plankDepth + 0.012) {
    const zc = z - plankDepth / 2;
    const y = bridgeDeckHeight(zc);
    const slope = Math.atan2(bridgeDeckHeight(zc + 0.1) - bridgeDeckHeight(zc - 0.1), 0.2);
    const g = new THREE.BoxGeometry(width + range(rng, -0.04, 0.06), 0.06, plankDepth).toNonIndexed();
    g.deleteAttribute('uv');
    g.rotateX(slope);
    g.rotateY(range(rng, -0.015, 0.015));
    g.translate(x + range(rng, -0.02, 0.02), y, zc);
    colorize(g, plank, rng);
    parts.push(g);
  }

  // 縱樑（橋面下方兩根，分段沿拱形）
  const segments = 10;
  for (const side of [-1, 1]) {
    for (let i = 0; i < segments; i++) {
      const za = zNear - ((zNear - zFar) * i) / segments;
      const zb = zNear - ((zNear - zFar) * (i + 1)) / segments;
      const a = new THREE.Vector3(x + side * (width / 2 - 0.12), bridgeDeckHeight(za) - 0.1, za);
      const b = new THREE.Vector3(x + side * (width / 2 - 0.12), bridgeDeckHeight(zb) - 0.1, zb);
      parts.push(beam(a, b, 0.12, 0.14, frame, rng));
    }
  }

  // 欄杆：每側 4 根柱，上下兩道橫桿
  const posts = 4;
  const railHeight = 0.82;
  for (const side of [-1, 1]) {
    const px = x + side * (width / 2 + 0.02);
    const tops = [];
    for (let i = 0; i < posts; i++) {
      const t = (i + 0.5) / posts;
      const z = zNear - 0.25 - (zNear - zFar - 0.5) * (i / (posts - 1));
      const base = bridgeDeckHeight(z) - 0.12;
      const height = railHeight + 0.12 + (i === 0 || i === posts - 1 ? 0.08 : 0);
      parts.push(box(0.11, height, 0.11, px, base + height / 2, z, frame, rng));
      // 柱頭一點點斜切感：小方帽
      parts.push(box(0.13, 0.03, 0.13, px, base + height + 0.015, z, frame, rng));
      tops.push({ z, base, t });
    }
    for (let i = 0; i < posts - 1; i++) {
      for (const [h, size] of [[railHeight, 0.07], [railHeight * 0.48, 0.05]]) {
        const a = new THREE.Vector3(px, tops[i].base + 0.12 + h, tops[i].z);
        const b = new THREE.Vector3(px, tops[i + 1].base + 0.12 + h, tops[i + 1].z);
        parts.push(beam(a, b, size, size * 0.9, plank, rng));
      }
    }
  }

  // 橋墩：插進溪床的圓木
  for (const z of [BRIDGE.z + (zNear - BRIDGE.z) * 0.45, BRIDGE.z - (BRIDGE.z - zFar) * 0.45]) {
    for (const side of [-1, 1]) {
      const top = bridgeDeckHeight(z) - 0.12;
      const bottom = WATER_LEVEL - 0.6;
      const g = new THREE.CylinderGeometry(0.08, 0.09, top - bottom, 8).toNonIndexed();
      g.deleteAttribute('uv');
      g.translate(x + side * (width / 2 - 0.12), (top + bottom) / 2, z);
      colorize(g, frame, rng);
      parts.push(g);
    }
  }

  const geometry = mergeGeometries(parts);
  geometry.computeVertexNormals();
  const material = createWoodMaterial({ color: 0xffffff });
  material.vertexColors = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'bridge';
  return mesh;
}
