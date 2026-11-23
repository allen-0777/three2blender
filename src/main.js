// 大氣模組會覆寫 three 的霧 shader chunk，必須在任何材質建立之前載入
import './atmosphere.js';
import * as THREE from 'three';
import { createRng } from './palette.js';
import { createEnvironment, sunDirection } from './environment.js';
import { createForest } from './trees.js';
import { createFallingLeaves, createGroundLeaves } from './leaves.js';
import { createWishLeaves } from './wishLeaves.js';
import { initWishWall } from './wishWall.js';
import { createPost } from './post.js';
import { focalLengthForAspect, verticalFieldOfView } from './lens.js';
import { TIERS, TIER_ORDER, chooseInitialTier, createFrameWatch } from './quality.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSmallScreen = window.matchMedia('(max-width: 768px)').matches;
const params = new URLSearchParams(window.location.search);

const initial = chooseInitialTier({ isSmallScreen });
let tierName = initial.tier;
let tier = TIERS[tierName];
// 自動降級的中間步驟：先把輔助 pass 降到一半，再換檔，最後才降主畫面解析度
let auxScale = 1;
let pixelRatioLimit = Infinity;

const canvas = document.querySelector('#scene');
// 主畫面先畫進多重取樣的 HDR render target，canvas 本身不需要 MSAA
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
// tone mapping 只在最後畫到螢幕的那一個 pass 生效（three 對 render target 不做 tone mapping）
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
// r187 已移除 PCFSoftShadowMap；PCFShadowMap 本身就是 Vogel disk 柔邊（半影寬度看 light.shadow.radius）
renderer.shadowMap.type = THREE.PCFShadowMap;
// 太陽與樹都是靜止的，陰影只在場景內容改變時重算一次
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

const post = createPost(renderer, { sunDirection });
document.documentElement.classList.toggle('has-post', post.supported);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 400);
const CAMERA_BASE = new THREE.Vector3(0, 1.9, 12);
const LOOK_AT = new THREE.Vector3(0, 2.7, -10);
camera.position.copy(CAMERA_BASE);

// 開場的檔次決定貼圖解析度與陰影圖大小；之後降級只關效果、減份量，不重新載入貼圖
const rng = createRng(20261121);
createEnvironment(scene, rng, {
  textureSize: tier.textureSize,
  anisotropy: Math.min(tier.anisotropy, renderer.capabilities.getMaxAnisotropy()),
  shadowMapSize: tier.shadowMapSize,
});
// 楓樹模型非同步載入；用獨立的亂數序列，載入時機不影響其他物件的配置
createForest(createRng(7), { barkNormals: tier.barkNormals })
  .then((forest) => {
    scene.add(forest);
    renderer.shadowMap.needsUpdate = true;
  })
  .catch((error) => console.error('楓樹模型載入失敗', error));

const groundLeaves = createGroundLeaves({ count: tier.groundLeaves, rng });
scene.add(groundLeaves);
const groundLeafCapacity = tier.groundLeaves;

const fallingLeafCapacity = reducedMotion ? 250 : tier.fallingLeaves;
const fallingLeaves = createFallingLeaves({
  count: fallingLeafCapacity,
  speedScale: reducedMotion ? 0.4 : 1,
  rng,
});
scene.add(fallingLeaves.mesh);

// 許願楓葉：每片對應資料庫裡的一則留言
const wishLeaves = createWishLeaves({ camera, cameraBase: CAMERA_BASE, reducedMotion });
scene.add(wishLeaves.group);

// ---- 鏡頭：36 mm 寬 16:9 片門，焦距隨畫面比例配合 ----
const lens = { focalLength: 35, focus: 11 };
const forcedFocalLength = Number(params.get('mm')) || null;

function currentPixelRatio() {
  return Math.min(window.devicePixelRatio || 1, tier.pixelRatioCap, pixelRatioLimit);
}

function resize() {
  const { innerWidth: width, innerHeight: height } = window;
  if (width <= 0 || height <= 0) return;
  const ratio = currentPixelRatio();
  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, false); // 顯示尺寸由 CSS 決定
  camera.aspect = width / height;
  lens.focalLength = forcedFocalLength ?? focalLengthForAspect(camera.aspect);
  camera.fov = verticalFieldOfView(lens.focalLength);
  camera.updateProjectionMatrix();
  post.resize();
  wishLeaves.layout();
}

function applyTier() {
  const dofAllowed = params.get('dof') !== '0';
  post.configure({
    dof: tier.dof && dofAllowed,
    glow: tier.glow,
    rays: tier.rays,
    // 2× 以上已是超取樣，MSAA 用 2 就夠；1× 螢幕用 4
    msaa: currentPixelRatio() >= 1.75 ? 2 : 4,
    auxScale,
  });
  fallingLeaves.setCount(Math.min(fallingLeafCapacity, reducedMotion ? 250 : tier.fallingLeaves));
  groundLeaves.count = Math.min(groundLeafCapacity, tier.groundLeaves);
  document.documentElement.dataset.quality = tierName;
  resize();
}
applyTier();
window.addEventListener('resize', resize);

// 幀時間太長時依序：輔助 pass 減半 → 降一檔 → 主畫面解析度降到 1×
function degrade(averageMs) {
  let step;
  if (tierName === 'high' && auxScale > 0.5) {
    auxScale = 0.5;
    step = '輔助 pass 解析度減半';
  } else if (TIER_ORDER.indexOf(tierName) < TIER_ORDER.length - 1) {
    tierName = TIER_ORDER[TIER_ORDER.indexOf(tierName) + 1];
    tier = TIERS[tierName];
    auxScale = 1;
    step = `降到 ${tierName}`;
  } else if (pixelRatioLimit > 1) {
    pixelRatioLimit = 1;
    step = '主畫面解析度降到 1×';
  } else {
    return;
  }
  console.info(`[畫質] 平均 ${averageMs.toFixed(1)} ms／幀，${step}`);
  applyTier();
}
const frameWatch = createFrameWatch({ onSlow: degrade });

const wishWall = initWishWall({ canvas, camera, wishLeaves });
// 給除錯與自動化驗收用
window.__wishWall = { leaves: wishLeaves, ...wishWall };
window.__visual = {
  get tier() {
    return tierName;
  },
  get lens() {
    return { ...lens, fov: camera.fov, fStop: post.look.fStop };
  },
  get frameMs() {
    return frameWatch.average;
  },
  get pixelRatio() {
    return renderer.getPixelRatio();
  },
  look: post.look,
  renderer,
  info: () => ({ tier: tierName, auxScale, forced: initial.forced, reducedMotion, ...post.info() }),
  setExposure(value) {
    renderer.toneMappingExposure = value;
  },
};

// 滑鼠視差：pointer 為 -1..1
const pointer = new THREE.Vector2();
if (!reducedMotion) {
  window.addEventListener('pointermove', (event) => {
    pointer.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      -((event.clientY / window.innerHeight) * 2 - 1),
    );
  });
}

const formDialog = document.getElementById('wish-form-dialog');
let previous = performance.now();
let frame = 0;
let pendingDt = 0;
renderer.setAnimationLoop((now) => {
  const elapsed = now - previous;
  previous = now;
  frame += 1;
  // 表單開著（使用者在打字）時畫面減半更新，把主執行緒與 GPU 讓給輸入
  pendingDt += elapsed;
  if (formDialog.open && frame % 2 === 1) return;
  if (!initial.forced && !formDialog.open) frameWatch.sample(elapsed);

  // 分頁切回來時避免一次跳一大步
  const dt = Math.min(pendingDt / 1000, 0.05);
  pendingDt = 0;
  const time = now / 1000;

  fallingLeaves.update(dt, time);

  const drift = reducedMotion ? 0 : Math.sin(time * 0.15) * 0.25;
  const targetX = CAMERA_BASE.x + pointer.x * 0.9 + drift;
  const targetY = CAMERA_BASE.y + pointer.y * 0.35;
  const ease = 1 - Math.exp(-dt * 2.5);
  camera.position.x += (targetX - camera.position.x) * ease;
  camera.position.y += (targetY - camera.position.y) * ease;
  camera.lookAt(LOOK_AT);

  // 鏡頭定位後再更新，光暈才會正對鏡頭
  wishLeaves.update(dt, time);

  // 對焦：平常停在讓整面許願牆清楚的距離；點開某片時慢慢拉到那一片，關卡片後回來
  lens.focus += (wishLeaves.focusDepth() - lens.focus) * (1 - Math.exp(-dt * 2.2));

  post.render(scene, camera, lens);
});
