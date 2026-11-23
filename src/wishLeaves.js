import * as THREE from 'three';
import { createRng, pick, range } from './palette.js';
import { leafGeometry, LEAF_OUTLINE, LEAF_VEIN_BASE } from './leaves.js';

// 許願楓葉：比一般落葉大、自己會發光，每片對應一則留言。
// 發光分三層，都是暖色、沒有硬邊：葉身的內部光（葉脈與葉心較亮）、
// 沿輪廓往外淡出的邊緣光、以及面向鏡頭的柔和光暈。
// 全部用 InstancedMesh 繪製（葉片、邊緣光、光暈各一個 draw call）。

const WISH_COLORS = [0xffc94d, 0xffa53a, 0xff7a3a, 0xf45a3c, 0xffd978, 0xff8f5a];
const EDGE_COLOR = 0xffb45e;
const HALO_COLOR = 0xffc978;
// 後期（ACES）會壓暗接近 1 的亮部並讓亮黃色變淡，自發光補償回來
// （用葉色再乘一次自己，保住飽和度）
const BODY_GLOW = 0.8;
// 邊緣光：緊貼輪廓處的亮度（疊加）與往外淡出的寬度（葉片約 1 單位大）
const EDGE_GLOW = 0.42;
const EDGE_WIDTH = 0.19;

const TAU = Math.PI * 2;
const DEFAULT_FOCUS = 11;
// 中央標題的預設範圍（畫面座標：中心 0、邊緣 ±1，上為正）；main.js 會依實際的 DOM 位置更新
const DEFAULT_TITLE_ZONE = { x: 0.44, top: 0.24, bottom: -0.24 };
// 自己剛留下的那片：邊緣光與光暈加強，在一整面許願葉裡也找得到
const FRESH_GLOW = 2.6;
// 葉片大小原本是照 50° 垂直視角調的
const REFERENCE_HALF_TAN = Math.tan((25 * Math.PI) / 180);
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

function createHaloTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // 中心一點小而亮的光核：許願葉獨有的記號，一般落葉沒有
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.06, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.32)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 邊緣光的幾何：沿葉片輪廓往外長出一圈裙邊，頂點色由輪廓處的白淡到外緣的黑。
 * 配合疊加混合，就是一圈貼著葉緣、往外消失的光，沒有可辨認的外框線。
 */
function createEdgeGlowGeometry() {
  const count = LEAF_OUTLINE.length;
  // 每個輪廓頂點的外推方向：相鄰兩邊外法線的平均（輪廓為逆時針，外側在行進方向右手邊）
  const directions = LEAF_OUTLINE.map(([x, y], i) => {
    const [px, py] = LEAF_OUTLINE[(i + count - 1) % count];
    const [nx, ny] = LEAF_OUTLINE[(i + 1) % count];
    const a = new THREE.Vector2(y - py, px - x).normalize();
    const b = new THREE.Vector2(ny - y, x - nx).normalize();
    const direction = a.add(b);
    return direction.lengthSq() < 1e-6 ? new THREE.Vector2(y - py, px - x).normalize() : direction.normalize();
  });
  // 三圈：輪廓、中段、外緣；中段的亮度低於線性，接近指數衰減
  const rings = [
    [0, 1],
    [0.35, 0.32],
    [1, 0],
  ];
  const positions = [];
  const colors = [];
  for (const [offset, level] of rings) {
    LEAF_OUTLINE.forEach(([x, y], i) => {
      positions.push(x + directions[i].x * EDGE_WIDTH * offset, y + directions[i].y * EDGE_WIDTH * offset, 0);
      colors.push(level, level, level);
    });
  }
  const index = [];
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let i = 0; i < count; i++) {
      const a = ring * count + i;
      const b = ring * count + ((i + 1) % count);
      index.push(a, b, a + count, b, b + count, a + count);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  return geometry;
}

function createMeshes(capacity) {
  const bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide });
  // 內部光：葉片帶自身顏色的光，葉脈匯集處最亮、往葉尖漸弱，葉脈本身像透著光的細線。
  // 逆光下也清楚可辨，而且亮度有起伏，不像一張平塗的貼紙。
  bodyMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWishUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWishUv = position.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec2 vWishUv;
        float wishSegment( vec2 p, vec2 a, vec2 b ) {
          vec2 pa = p - a, ba = b - a;
          return length( pa - ba * clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 ) );
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          vec2 wishP = vec2( abs( vWishUv.x ), vWishUv.y );
          const vec2 wishBase = vec2( ${LEAF_VEIN_BASE[0].toFixed(2)}, ${LEAF_VEIN_BASE[1].toFixed(2)} );
          float wishVein = min( wishSegment( wishP, vec2( 0.0, -0.5 ), vec2( 0.0, 0.5 ) ) * 0.7,
            min( wishSegment( wishP, wishBase, vec2( 0.45, 0.19 ) ),
            min( wishSegment( wishP, wishBase, vec2( 0.47, -0.03 ) ),
                 wishSegment( wishP, wishBase, vec2( 0.19, 0.4 ) ) ) ) );
          // 葉脈周圍一圈柔光 + 中間一條細亮線；葉子在畫面上很小時細線淡出，避免閃爍
          float wishSoft = exp( - wishVein * 13.0 );
          float wishLine = ( 1.0 - smoothstep( 0.0, max( 0.012, fwidth( wishVein ) ), wishVein ) )
            * saturate( 0.02 / max( fwidth( wishVein ), 0.0001 ) );
          // 葉心（葉脈匯集處略上方）往外漸弱
          float wishCore = 1.0 - smoothstep( 0.05, 0.62, length( vWishUv - vec2( 0.0, -0.06 ) ) );
          vec3 wishTint = diffuseColor.rgb * ( 0.3 + 0.7 * diffuseColor.rgb );
          float wishLevel = 0.5 + 0.45 * wishCore + 0.3 * wishSoft;
          totalEmissiveRadiance += wishTint * wishLevel * ${BODY_GLOW.toFixed(2)}
            + mix( wishTint, vec3( 1.0, 0.8, 0.5 ), 0.6 ) * wishLine * 0.4;
        }`,
      );
  };
  const body = new THREE.InstancedMesh(leafGeometry, bodyMaterial, capacity);

  // 邊緣光：貼著輪廓往外淡出的暖光（疊加、不寫入深度）
  const edge = new THREE.InstancedMesh(
    createEdgeGlowGeometry(),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(EDGE_COLOR).multiplyScalar(EDGE_GLOW),
      vertexColors: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      // 疊加混合不能再混霧色（同光暈）
      fog: false,
    }),
    capacity,
  );

  const halo = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: createHaloTexture(),
      color: HALO_COLOR,
      transparent: true,
      // 後期管線在線性空間混合，疊加的光暈比以前在 sRGB 空間混合時強，所以不透明度調低
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // 疊加混合不能再混霧色，否則整塊方形會被霧染亮
      fog: false,
    }),
    capacity,
  );

  body.renderOrder = 1;
  edge.renderOrder = 2;
  halo.renderOrder = 3;
  for (const mesh of [body, edge, halo]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  return { body, edge, halo };
}

/**
 * 建立許願楓葉群。
 * cameraBase：鏡頭的基準位置，用來把每片葉子排進目前畫面比例看得到的範圍。
 * keepOut：{ x, y } 畫面右上角保留給前景樹枝的範圍（framing.js），葉子的停留位置會避開。
 */
export function createWishLeaves({ camera, cameraBase, reducedMotion = false, capacity = 140, keepOut = null }) {
  let TITLE_ZONE = { ...DEFAULT_TITLE_ZONE };
  const { body, edge, halo } = createMeshes(capacity);
  const group = new THREE.Group();
  group.add(body, edge, halo);
  const edgeBase = edge.material.color.clone();
  const haloBase = halo.material.opacity;

  /** @type {Array<object>} 依 id 由小到大 */
  const leaves = [];
  const byId = new Map();
  let selectedId = null;
  let clock = 0;

  const motion = reducedMotion ? 0.3 : 1;
  // 飄落途中額外的位移（公尺，落定時歸零）：場景二讓葉子飄落時略往神木的方向飄
  const fallBias = new THREE.Vector3();
  // 鏡頭焦距會隨畫面比例調整（main.js），每次 layout 重新取視角
  let halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  // 沒有選取時的對焦距離（沿鏡頭前方的公尺數），見 focusDepth()
  let restFocus = DEFAULT_FOCUS;

  /** 依目前畫面比例，算出葉子停留的世界座標 */
  function placeHome(leaf) {
    const depth = leaf.featured ? 6.5 + leaf.depthT * 2 : 7 + leaf.depthT ** 1.3 * 19;
    const halfWidth = Math.min(depth * halfTan * camera.aspect * 0.84, 15);
    const top = Math.min(cameraBase.y + depth * (0.036 + halfTan * 0.74), 7.2);
    const u = leaf.featured ? leaf.u * 0.4 : leaf.u;
    const v = leaf.featured ? 0.3 + leaf.v * 0.3 : leaf.v;
    leaf.home.set(u * halfWidth, 0.5 + v * (top - 0.5), cameraBase.z - depth);
    const toScreenX = depth * halfTan * camera.aspect;
    const toScreenY = depth * halfTan;
    let screenX = leaf.home.x / toScreenX;
    let screenY = (leaf.home.y - cameraBase.y) / toScreenY;
    // 避開中央標題「楓葉季」：自己剛留下的那片移到標題正下方（標題與按鈕之間，背景較暗、最顯眼），
    // 其他的往左右推出標題範圍
    // 停留時還會飄動（driftX／driftY 公尺），範圍再放寬這麼多
    const marginX = (leaf.driftX * 1.1) / toScreenX;
    const marginY = (leaf.driftY * 1.1) / toScreenY;
    if (
      Math.abs(screenX) < TITLE_ZONE.x + marginX &&
      screenY > TITLE_ZONE.bottom - marginY &&
      screenY < TITLE_ZONE.top + marginY
    ) {
      if (leaf.featured) {
        leaf.home.y = cameraBase.y + (TITLE_ZONE.bottom - 0.04 - 0.04 * leaf.v) * toScreenY;
      } else if (TITLE_ZONE.x + marginX < 0.62) {
        const side = screenX < 0 ? -1 : 1;
        leaf.home.x = side * (TITLE_ZONE.x + marginX + 0.03 + Math.abs(screenX) * 0.4) * toScreenX;
      } else {
        // 直式畫面：標題幾乎和畫面一樣寬，改成上下錯開——一部分到標題上方的樹冠，
        // 一部分到標題下方、樹幹之間的高度，不要全擠在同一塊
        const above = leaf.v > 0.28;
        const y = above
          ? Math.min(TITLE_ZONE.top + marginY + 0.04 + 0.62 * (leaf.v - 0.28), 0.85)
          : TITLE_ZONE.bottom - marginY - 0.03 - 0.3 * leaf.v;
        leaf.home.y = Math.max(cameraBase.y + y * toScreenY, 0.6);
      }
      screenX = leaf.home.x / toScreenX;
      screenY = (leaf.home.y - cameraBase.y) / toScreenY;
    }
    // 避開前景樹枝佔用的右上角（keepOut：畫面座標，中心 0、邊緣 1）
    // side：1 = 右上角（場景一），-1 = 左上角（場景二的前景楓枝在左邊）
    if (keepOut && screenX * (keepOut.side ?? 1) > keepOut.x - 0.08 && screenY > keepOut.y - 0.12) {
      leaf.home.y = cameraBase.y + (keepOut.y - 0.12 - 0.25 * leaf.v) * toScreenY;
    }
  }

  const glowLevel = new THREE.Color();
  function syncColors() {
    leaves.forEach((leaf, i) => {
      body.setColorAt(i, leaf.color);
      // 遠近層次：越遠的許願葉邊緣光與光暈越淡，近的與自己剛留下的最亮
      glowLevel.setScalar(leaf.featured ? FRESH_GLOW : 1.15 - 0.7 * leaf.depthT);
      edge.setColorAt(i, glowLevel);
      halo.setColorAt(i, glowLevel);
    });
    for (const mesh of [body, edge, halo]) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    body.count = edge.count = halo.count = leaves.length;
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
      size: featured ? 0.7 : range(rng, 0.44, 0.56),
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
    updateRestFocus();
    return true;
  }

  /** 讓所有許願葉都盡量清楚的對焦距離：景深模糊量正比於 |1/對焦 − 1/距離|，取倒數的中點 */
  function updateRestFocus() {
    if (leaves.length === 0) {
      restFocus = DEFAULT_FOCUS;
      return;
    }
    let nearest = Infinity;
    let farthest = 0;
    for (const leaf of leaves) {
      const depth = cameraBase.z - leaf.home.z;
      nearest = Math.min(nearest, depth);
      farthest = Math.max(farthest, depth);
    }
    restFocus = 2 / (1 / nearest + 1 / farthest);
  }

  function layout() {
    halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    leaves.forEach(placeHome);
    updateRestFocus();
  }

  const dummy = new THREE.Object3D();
  const haloDummy = new THREE.Object3D();

  function update(dt, time) {
    clock += dt;
    const ease = 1 - Math.exp(-dt * 8);
    // 直式（手機）畫面可用寬度窄，葉子縮小一些才不會擠成一團
    // 焦距較長（視角較窄）時同樣大小的葉子在畫面上會變大，依視角縮回接近原本的佔比
    const fit = THREE.MathUtils.clamp(camera.aspect / 1.1, 0.6, 1) * Math.min(1, (halfTan / REFERENCE_HALF_TAN) ** 0.75);

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
        leaf.position.addScaledVector(fallBias, falling);
      }

      const targetEmphasis = leaf.wish.id === selectedId ? 1 : 0;
      leaf.emphasis += (targetEmphasis - leaf.emphasis) * ease;
      const appear = leaf.arrive === 'fall' ? Math.min(t * 12, 1) : settled;
      // 被點開的那片在卡片後面略縮小，不從卡片兩側露出葉尖（焦點仍然跟著它）
      // 鏡頭貼得很近時（驗收用的近景鏡位）縮小，不會變成蓋住半個畫面的過曝光團；首頁鏡位最近也有 5 公尺，不受影響
      const near = THREE.MathUtils.smoothstep(dummy.position.copy(leaf.position).distanceTo(camera.position), 1.5, 3.5);
      leaf.scaleNow = leaf.size * fit * appear * (1 - leaf.emphasis * 0.45) * near;

      dummy.position.copy(leaf.position);
      dummy.rotation.set(
        Math.sin(b) * 0.3 * motion + leaf.spin.x * falling * 7,
        Math.sin(a) * 0.65 * motion + leaf.spin.y * falling * 7,
        leaf.tilt + Math.sin(a * 1.3) * 0.2 * motion + leaf.spin.z * falling * 5,
      );
      dummy.scale.setScalar(leaf.scaleNow);
      dummy.updateMatrix();
      body.setMatrixAt(i, dummy.matrix);
      // 邊緣光與葉片同一個變換（裙邊從輪廓往外長，不需要另外放大）
      edge.setMatrixAt(i, dummy.matrix);

      // 光暈永遠面向鏡頭，輕微呼吸
      const pulse =
        1 + Math.sin(time * 1.6 + leaf.phase) * (leaf.featured ? 0.22 : 0.1) * motion + leaf.emphasis * 0.35 + (leaf.featured ? 0.3 : 0);
      haloDummy.position.copy(leaf.position);
      haloDummy.quaternion.copy(camera.quaternion);
      haloDummy.scale.setScalar(leaf.scaleNow * 2.7 * pulse);
      haloDummy.updateMatrix();
      halo.setMatrixAt(i, haloDummy.matrix);
    }
    body.instanceMatrix.needsUpdate = true;
    edge.instanceMatrix.needsUpdate = true;
    halo.instanceMatrix.needsUpdate = true;
  }

  const toLeaf = new THREE.Vector3();
  const forward = new THREE.Vector3();

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
    /** 標題在畫面上的範圍（中心 0、邊緣 ±1，上為正；左右對稱取 x 半寬），許願葉的停留位置會避開 */
    setTitleZone(zone) {
      TITLE_ZONE = { ...zone };
      layout();
    },
    update,
    pick: pickWish,
    /** 前景樹枝佔用的角落（見 placeHome），null 表示不避開 */
    setKeepOut(next) {
      keepOut = next;
      layout();
    },
    /** 飄落途中的額外位移（落定時為 0，不影響停留位置與點擊） */
    setFallBias(x, y, z) {
      fallBias.set(x, y, z);
    },
    /** 邊緣光與光暈的整體強度（夜晚加強，讓許願葉更顯眼） */
    setGlowBoost(boost) {
      edge.material.color.copy(edgeBase).multiplyScalar(boost);
      // 光暈不跟著放大太多：夜晚一整片光暈會連成一團、壓到標題
      halo.material.opacity = haloBase * Math.min(boost, 1.15);
    },
    has: (id) => byId.has(id),
    setSelected(id) {
      selectedId = id;
    },
    /**
     * 後期景深用的對焦距離（沿鏡頭前方的公尺數）。
     * 有選取的楓葉時回傳那一片的距離，否則回傳讓整面許願牆都清楚的距離。
     */
    focusDepth() {
      const leaf = selectedId === null ? null : byId.get(selectedId);
      if (!leaf) return restFocus;
      camera.getWorldDirection(forward);
      return Math.max(toLeaf.copy(leaf.position).sub(camera.position).dot(forward), 1);
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
