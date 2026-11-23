import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createStoneMaterial, lanternUniforms } from './materials.js';
import { LANTERNS, groundHeight2 } from './terrain.js';

// 石燈籠（六角形的春日型，程式生成）：基礎、竿、中台、火袋、笠、寶珠。
// 白天火袋是暗的開口；黃昏、夜晚點亮：火袋窗發出暖光、周圍一圈柔光，
// 同時把亮度寫進 lanternUniforms，地面、石頭、木橋與水面會被照亮（見 materials.js）。

const HEX_START = Math.PI / 6; // 讓六角形的一個面正對 +z
const FIREBOX = { y: 1.0, height: 0.3, radius: 0.2 };

/** 平面著色（六角形的稜線要分明）：轉成 non-indexed 再算法線 */
const faceted = (geometry) => {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
};
const round = (geometry) => {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  return g;
};

function hexPrism(radiusTop, radiusBottom, height, y) {
  return faceted(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 6, 1, false, HEX_START).translate(0, y + height / 2, 0));
}

function lathe(points, segments, start = HEX_START, flat = true) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments, start);
  return flat ? faceted(g) : round(g);
}

function createStoneGeometry() {
  const parts = [
    // 基礎
    hexPrism(0.27, 0.31, 0.13, 0),
    lathe([[0.27, 0.13], [0.24, 0.17], [0.16, 0.2], [0.12, 0.22], [0, 0.22]], 6),
    // 竿：圓柱，中段一圈節
    round(new THREE.CylinderGeometry(0.095, 0.11, 0.64, 14, 1, true).translate(0, 0.22 + 0.32, 0)),
    round(new THREE.CylinderGeometry(0.115, 0.115, 0.04, 14).translate(0, 0.55, 0)),
    // 中台：往上外擴
    lathe([[0, 0.84], [0.12, 0.84], [0.16, 0.88], [0.26, 0.94], [0.28, 0.98], [0.27, 1.0], [0, 1.0]], 6),
    // 火袋（四周有窗，窗另外畫）
    hexPrism(FIREBOX.radius, FIREBOX.radius, FIREBOX.height, FIREBOX.y),
    // 笠：六角、緩坡，邊緣微微上翹
    lathe(
      [[0, 1.3], [0.16, 1.3], [0.42, 1.315], [0.475, 1.345], [0.465, 1.375], [0.38, 1.385], [0.2, 1.45], [0.06, 1.52], [0, 1.53]],
      6,
    ),
    // 寶珠
    lathe([[0, 1.52], [0.07, 1.53], [0.08, 1.56], [0.065, 1.6], [0.035, 1.64], [0.012, 1.68], [0, 1.69]], 12, 0, false),
  ];
  const geometry = mergeGeometries(parts);
  geometry.computeBoundingSphere();
  return geometry;
}

/** 火袋的六扇窗：中心一點最亮、窗框的木格是暗的（uv 畫格子） */
function createWindowGeometry() {
  const apothem = FIREBOX.radius * Math.cos(Math.PI / 6) + 0.004;
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const plane = new THREE.PlaneGeometry(0.15, 0.17);
    plane.translate(0, 0, apothem);
    plane.rotateY(angle);
    plane.translate(0, FIREBOX.y + FIREBOX.height / 2, 0);
    parts.push(plane);
  }
  return mergeGeometries(parts);
}

function createWindowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLevel: { value: 0 },
      uColor: { value: new THREE.Color(1.0, 0.36, 0.08) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 p = vec4( position, 1.0 );
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uLevel;
      uniform vec3 uColor;
      void main() {
        // 2×2 的木格：細暗線
        vec2 g = abs( fract( vUv * vec2( 2.0, 2.0 ) ) - 0.5 );
        float bar = 1.0 - smoothstep( 0.42, 0.47, max( g.x, g.y ) );
        float edge = smoothstep( 0.0, 0.08, min( min( vUv.x, 1.0 - vUv.x ), min( vUv.y, 1.0 - vUv.y ) ) );
        float core = 1.0 - smoothstep( 0.0, 0.75, length( vUv - 0.5 ) );
        // 白天：火袋裡是暗的空洞
        vec3 day = vec3( 0.012, 0.009, 0.007 );
        vec3 lit = uColor * uLevel * ( 0.5 + 1.6 * core ) * mix( 0.25, 1.0, bar ) * edge;
        gl_FragColor = vec4( day + lit, 1.0 );
      }
    `,
  });
}

function createHaloTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 回傳 { group, setLevel(0..), update(camera) } */
export function createLanterns() {
  const stone = new THREE.InstancedMesh(createStoneGeometry(), createStoneMaterial({ color: 0xa8a092, moss: 0.65, lanternGain: 0.12 }), LANTERNS.length);
  const windowMaterial = createWindowMaterial();
  const windows = new THREE.InstancedMesh(createWindowGeometry(), windowMaterial, LANTERNS.length);
  const haloMaterial = new THREE.MeshBasicMaterial({
    map: createHaloTexture(),
    color: new THREE.Color(1.0, 0.6, 0.28),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    opacity: 0,
  });
  const halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), haloMaterial, LANTERNS.length);
  halos.renderOrder = 3;

  const dummy = new THREE.Object3D();
  const fireboxes = [];
  LANTERNS.forEach((l, i) => {
    const y = groundHeight2(l.x, l.z) - 0.04;
    // 一個面大致朝向小徑，再加一點隨意的偏轉
    dummy.position.set(l.x, y, l.z);
    dummy.rotation.set(0, Math.atan2(-l.x, 2) * 0.5 + (i % 2 ? 0.12 : -0.1), 0);
    dummy.scale.setScalar(l.scale);
    dummy.updateMatrix();
    stone.setMatrixAt(i, dummy.matrix);
    windows.setMatrixAt(i, dummy.matrix);
    const center = new THREE.Vector3(l.x, y + (FIREBOX.y + FIREBOX.height / 2) * l.scale, l.z);
    fireboxes.push({ center, scale: l.scale });
    lanternUniforms.uLanterns.value[i].set(center.x, center.y, center.z, 0);
  });
  for (const mesh of [stone, windows, halos]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
  }
  stone.castShadow = true;
  stone.receiveShadow = true;

  const group = new THREE.Group();
  group.name = 'lanterns';
  group.add(stone, windows, halos);
  let level = 0;

  return {
    group,
    stone,
    halos,
    /** 0 = 白天不亮；黃昏約 1；夜晚約 1.6 */
    setLevel(next) {
      level = next;
      windowMaterial.uniforms.uLevel.value = next * 1.0;
      haloMaterial.opacity = Math.min(next, 1.6) * 0.5;
      halos.visible = next > 0;
      lanternUniforms.uLanterns.value.forEach((v) => {
        v.w = next * 5.0;
      });
    },
    get level() {
      return level;
    },
    update(camera, time) {
      if (!halos.visible) return;
      fireboxes.forEach((f, i) => {
        dummy.position.copy(f.center);
        dummy.quaternion.copy(camera.quaternion);
        // 很輕的燭火搖曳
        const flicker = 1 + Math.sin(time * 7.3 + i * 1.7) * 0.03 + Math.sin(time * 13.1 + i) * 0.02;
        dummy.scale.setScalar(1.5 * f.scale * flicker);
        dummy.updateMatrix();
        halos.setMatrixAt(i, dummy.matrix);
      });
      halos.instanceMatrix.needsUpdate = true;
    },
  };
}
