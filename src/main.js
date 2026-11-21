import * as THREE from 'three';
import { createRng } from './palette.js';
import { createEnvironment } from './environment.js';
import { createForest } from './trees.js';
import { createFallingLeaves, createGroundLeaves } from './leaves.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSmallScreen = window.matchMedia('(max-width: 768px)').matches;

const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isSmallScreen ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
const CAMERA_BASE = new THREE.Vector3(0, 1.9, 12);
const LOOK_AT = new THREE.Vector3(0, 2.7, -10);
camera.position.copy(CAMERA_BASE);

const rng = createRng(20261121);
createEnvironment(scene, rng);
scene.add(createForest(rng));
scene.add(createGroundLeaves({ count: isSmallScreen ? 1200 : 2600, rng }));

const fallingLeaves = createFallingLeaves({
  count: reducedMotion ? 250 : isSmallScreen ? 450 : 850,
  speedScale: reducedMotion ? 0.4 : 1,
  rng,
});
scene.add(fallingLeaves.mesh);

function resize() {
  const { innerWidth: width, innerHeight: height } = window;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

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

let previous = performance.now();
renderer.setAnimationLoop((now) => {
  // 分頁切回來時避免一次跳一大步
  const dt = Math.min((now - previous) / 1000, 0.05);
  previous = now;
  const time = now / 1000;

  fallingLeaves.update(dt, time);

  const drift = reducedMotion ? 0 : Math.sin(time * 0.15) * 0.25;
  const targetX = CAMERA_BASE.x + pointer.x * 0.9 + drift;
  const targetY = CAMERA_BASE.y + pointer.y * 0.35;
  const ease = 1 - Math.exp(-dt * 2.5);
  camera.position.x += (targetX - camera.position.x) * ease;
  camera.position.y += (targetY - camera.position.y) * ease;
  camera.lookAt(LOOK_AT);

  renderer.render(scene, camera);
});
