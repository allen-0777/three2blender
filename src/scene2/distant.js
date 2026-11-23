import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { range } from '../palette.js';
import { groundHeight2 } from './terrain.js';

// 遠景林：60 公尺外一圈便宜的樹冠團塊（instanced 的擾動球 + 細樹幹），只為了在霧裡形成起伏的樹林輪廓，
// 遮住地面與天空的接縫。離得很遠、又被霧吃掉大半，不需要真的楓樹模型。

function blobGeometry() {
  const base = new THREE.IcosahedronGeometry(1, 2);
  base.deleteAttribute('normal');
  base.deleteAttribute('uv');
  const g = mergeVertices(base);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(1 + 0.18 * Math.sin(v.x * 4 + v.y * 3) * Math.sin(v.z * 5 - v.y * 2));
    p.setXYZ(i, v.x, v.y * 0.8 + 0.1, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function createDistantForest(rng, count = 170) {
  const group = new THREE.Group();
  group.name = 'distant-forest';
  const crowns = new THREE.InstancedMesh(blobGeometry(), new THREE.MeshStandardMaterial({ roughness: 1 }), count);
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.2, 1, 5).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 1 }),
    count,
  );
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const hues = [0x9c1c18, 0xb8301a, 0xc84a1c, 0x8a1a1e, 0xd2701e, 0xd9b02a];
  for (let i = 0; i < count; i++) {
    // 從鏡頭看出去的扇形，60～95 公尺
    const a = range(rng, -1.25, 1.25);
    const d = range(rng, 60, 95);
    const x = Math.sin(a) * d;
    const z = 12 - Math.cos(a) * d;
    const y = groundHeight2(x, z);
    const s = range(rng, 2.6, 4.6);
    const h = s * range(rng, 0.9, 1.3);
    dummy.position.set(x, y + s * 0.75, z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.set(s * range(rng, 1.0, 1.4), s * range(rng, 0.7, 1.0), s * range(rng, 1.0, 1.4));
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
    color.setHex(hues[Math.floor(rng() * hues.length)]).multiplyScalar(range(rng, 0.4, 0.7));
    crowns.setColorAt(i, color);
    dummy.position.set(x, y - 0.2, z);
    dummy.scale.set(s * 0.25, h + s * 0.5, s * 0.25);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
  }
  for (const m of [crowns, trunks]) {
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
    m.receiveShadow = true;
  }
  crowns.instanceColor.needsUpdate = true;
  // 樹幹不畫：在霧裡會變成一排沒有樹冠的細桿（盲審第 3 輪）
  trunks.visible = false;
  group.add(crowns);
  return group;
}
