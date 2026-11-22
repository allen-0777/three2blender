import * as THREE from 'three';
import { createRng, pick, range } from './palette.js';
import { leafGeometry } from './leaves.js';

// 許願楓葉：比一般落葉大、帶描邊與光暈，每片對應一則留言。
// 全部用 InstancedMesh 繪製（葉片、描邊、光暈各一個 draw call）。

const WISH_COLORS = [0xffc94d, 0xffa53a, 0xff7a3a, 0xf45a3c, 0xffd978, 0xff8f5a];
const RIM_COLOR = 0xfff3d0;
const HALO_COLOR = 0xffd58a;

const TAU = Math.PI * 2;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

function createHaloTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.32)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMeshes(capacity) {
  const bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide });
  // 讓葉片帶自身顏色的微光，逆光下也清楚可辨
  bodyMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.55;',
    );
  };
  const body = new THREE.InstancedMesh(leafGeometry, bodyMaterial, capacity);

  // 描邊：同一輪廓放大一圈、不寫入深度，先畫描邊再畫葉片
  const rim = new THREE.InstancedMesh(
    leafGeometry,
    new THREE.MeshBasicMaterial({ color: RIM_COLOR, side: THREE.DoubleSide, depthWrite: false }),
    capacity,
  );

  const halo = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: createHaloTexture(),
      color: HALO_COLOR,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    capacity,
  );

  rim.renderOrder = 1;
  body.renderOrder = 2;
  halo.renderOrder = 3;
  for (const mesh of [body, rim, halo]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  return { body, rim, halo };
}

/**
 * 建立許願楓葉群。
 * cameraBase：鏡頭的基準位置，用來把每片葉子排進目前畫面比例看得到的範圍。
 */
export function createWishLeaves({ camera, cameraBase, reducedMotion = false, capacity = 140 }) {
  const { body, rim, halo } = createMeshes(capacity);
  const group = new THREE.Group();
  group.add(rim, body, halo);

  /** @type {Array<object>} 依 id 由小到大 */
  const leaves = [];
  const byId = new Map();
  let selectedId = null;
  let clock = 0;

  const motion = reducedMotion ? 0.3 : 1;
  const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  /** 依目前畫面比例，算出葉子停留的世界座標 */
  function placeHome(leaf) {
    const depth = leaf.featured ? 6.5 + leaf.depthT * 2 : 7 + leaf.depthT ** 1.3 * 19;
    const halfWidth = Math.min(depth * halfTan * camera.aspect * 0.84, 15);
    const top = Math.min(cameraBase.y + depth * (0.036 + halfTan * 0.74), 7.2);
    const u = leaf.featured ? leaf.u * 0.4 : leaf.u;
    const v = leaf.featured ? 0.3 + leaf.v * 0.3 : leaf.v;
    leaf.home.set(u * halfWidth, 0.5 + v * (top - 0.5), cameraBase.z - depth);
  }

  function syncColors() {
    leaves.forEach((leaf, i) => body.setColorAt(i, leaf.color));
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    body.count = rim.count = halo.count = leaves.length;
  }

  function remove(leaf) {
    leaves.splice(leaves.indexOf(leaf), 1);
    byId.delete(leaf.wish.id);
  }

  /**
   * 加入一片許願楓葉。
   * arrive: 'fall' 從上方飄落；'appear' 原地浮現（頁面載入時用）
   * featured: 放在鏡頭前方中央（使用者自己剛送出的那片）
   */
  function add(wish, { arrive = 'fall', featured = false, delay = 0 } = {}) {
    if (byId.has(wish.id)) return false;

    // 以留言 id 為種子：同一則留言每次載入都在同一個位置
    const rng = createRng(wish.id * 2654435761);
    const leaf = {
      wish,
      featured,
      u: range(rng, -1, 1),
      v: rng(),
      depthT: rng(),
      size: featured ? 0.62 : range(rng, 0.44, 0.56),
      color: new THREE.Color(pick(rng, WISH_COLORS)),
      phase: rng() * TAU,
      phase2: rng() * TAU,
      tilt: range(rng, -0.35, 0.35),
      driftX: range(rng, 0.25, 0.5),
      driftY: range(rng, 0.15, 0.3),
      speed: range(rng, 0.35, 0.6),
      spin: new THREE.Vector3(range(rng, -1, 1), range(rng, -1, 1), range(rng, -0.6, 0.6)),
      startOffset: new THREE.Vector3(range(rng, -3, 3), range(rng, 7, 9.5), range(rng, -1.5, 1.5)),
      arrive: reducedMotion ? 'appear' : arrive,
      duration: arrive === 'fall' && !reducedMotion ? range(rng, 5.5, 7) : 0.9,
      startAt: clock + delay,
      home: new THREE.Vector3(),
      position: new THREE.Vector3(),
      scaleNow: 0,
      emphasis: 0,
    };
    placeHome(leaf);
    leaf.position.copy(leaf.home);

    const index = leaves.findIndex((other) => other.wish.id > wish.id);
    if (index === -1) leaves.push(leaf);
    else leaves.splice(index, 0, leaf);
    byId.set(wish.id, leaf);

    // 超過容量時移除最舊的（保留正在看的那片）
    while (leaves.length > capacity) {
      remove(leaves.find((other) => other.wish.id !== selectedId && other !== leaf) ?? leaves[0]);
    }
    syncColors();
    return true;
  }

  function layout() {
    leaves.forEach(placeHome);
  }

  const dummy = new THREE.Object3D();
  const haloDummy = new THREE.Object3D();

  function update(dt, time) {
    clock += dt;
    const ease = 1 - Math.exp(-dt * 8);
    // 直式（手機）畫面可用寬度窄，葉子縮小一些才不會擠成一團
    const fit = THREE.MathUtils.clamp(camera.aspect / 1.1, 0.6, 1);

    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      const t = THREE.MathUtils.clamp((clock - leaf.startAt) / leaf.duration, 0, 1);
      const settled = easeOutCubic(t);
      const falling = leaf.arrive === 'fall' ? 1 - settled : 0;

      // 停留時的緩慢飄動
      const a = time * leaf.speed + leaf.phase;
      const b = time * leaf.speed * 0.7 + leaf.phase2;
      const hover = settled * motion;
      leaf.position.set(
        leaf.home.x + Math.sin(a) * leaf.driftX * hover,
        leaf.home.y + Math.sin(b) * leaf.driftY * hover,
        leaf.home.z + Math.cos(a * 0.8) * 0.25 * hover,
      );
      // 飄落：從上方帶著左右擺盪落到定位
      if (falling > 0) {
        leaf.position.x += leaf.startOffset.x * falling + Math.sin(clock * 1.7 + leaf.phase) * 0.7 * falling;
        leaf.position.y += leaf.startOffset.y * falling;
        leaf.position.z += leaf.startOffset.z * falling;
      }

      const targetEmphasis = leaf.wish.id === selectedId ? 1 : 0;
      leaf.emphasis += (targetEmphasis - leaf.emphasis) * ease;
      const appear = leaf.arrive === 'fall' ? Math.min(t * 12, 1) : settled;
      leaf.scaleNow = leaf.size * fit * appear * (1 + leaf.emphasis * 0.3);

      dummy.position.copy(leaf.position);
      dummy.rotation.set(
        Math.sin(b) * 0.3 * motion + leaf.spin.x * falling * 7,
        Math.sin(a) * 0.65 * motion + leaf.spin.y * falling * 7,
        leaf.tilt + Math.sin(a * 1.3) * 0.2 * motion + leaf.spin.z * falling * 5,
      );
      dummy.scale.setScalar(leaf.scaleNow);
      dummy.updateMatrix();
      body.setMatrixAt(i, dummy.matrix);

      dummy.scale.setScalar(leaf.scaleNow * 1.16);
      dummy.updateMatrix();
      rim.setMatrixAt(i, dummy.matrix);

      // 光暈永遠面向鏡頭，輕微呼吸
      const pulse = 1 + Math.sin(time * 1.6 + leaf.phase) * 0.1 * motion + leaf.emphasis * 0.35;
      haloDummy.position.copy(leaf.position);
      haloDummy.quaternion.copy(camera.quaternion);
      haloDummy.scale.setScalar(leaf.scaleNow * 2.7 * pulse);
      haloDummy.updateMatrix();
      halo.setMatrixAt(i, haloDummy.matrix);
    }
    body.instanceMatrix.needsUpdate = true;
    rim.instanceMatrix.needsUpdate = true;
    halo.instanceMatrix.needsUpdate = true;
  }

  const toLeaf = new THREE.Vector3();

  /**
   * 用 raycaster 的射線找出被點到的楓葉，回傳對應的留言或 null。
   * 葉片又薄又會轉，直接打三角形很難點中，所以改測射線到葉心的距離；
   * minPixels 保證遠處的小葉子在螢幕上也有足夠大的點擊範圍（觸控友善）。
   */
  function pickWish(raycaster, { minPixels = 24, viewportHeight = window.innerHeight } = {}) {
    const { ray } = raycaster;
    let best = null;
    let bestScore = 1;
    for (const leaf of leaves) {
      if (leaf.scaleNow < leaf.size * 0.3) continue;
      const along = toLeaf.copy(leaf.position).sub(ray.origin).dot(ray.direction);
      if (along <= 0) continue;
      const worldPerPixel = (2 * along * halfTan) / viewportHeight;
      const radius = Math.max(leaf.scaleNow * 0.6, worldPerPixel * minPixels);
      const score = ray.distanceSqToPoint(leaf.position) / (radius * radius);
      if (score < bestScore) {
        bestScore = score;
        best = leaf;
      }
    }
    return best ? best.wish : null;
  }

  return {
    group,
    add,
    layout,
    update,
    pick: pickWish,
    has: (id) => byId.has(id),
    setSelected(id) {
      selectedId = id;
    },
    /** 留言在畫面上的位置（CSS 像素），給測試與除錯用 */
    screenPosition(id) {
      const leaf = byId.get(id);
      if (!leaf) return null;
      const projected = leaf.position.clone().project(camera);
      return {
        x: ((projected.x + 1) / 2) * window.innerWidth,
        y: ((1 - projected.y) / 2) * window.innerHeight,
      };
    },
    get size() {
      return leaves.length;
    },
  };
}
