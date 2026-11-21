import * as THREE from 'three';
import { SKY, FOG_COLOR, range } from './palette.js';

// 太陽方向：低角度、位於鏡頭前方偏左，形成逆光
const SUN_DIRECTION = new THREE.Vector3(-20, 9, -30).normalize();

function createSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(SKY.top) },
      uMid: { value: new THREE.Color(SKY.mid) },
      uHorizon: { value: new THREE.Color(SKY.horizon) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      varying vec3 vDirection;
      void main() {
        float h = normalize(vDirection).y;
        vec3 color = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
        color = mix(color, uTop, smoothstep(0.18, 0.75, h));
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), material);
}

function createSun() {
  const group = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(6, 48),
    new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false }),
  );
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(26, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffd08a,
      fog: false,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  halo.position.z = -0.5;
  group.add(halo, disc);
  group.position.copy(SUN_DIRECTION).multiplyScalar(170);
  group.lookAt(0, 0, 0);
  return group;
}

function createGround(rng) {
  const geometry = new THREE.PlaneGeometry(240, 240, 96, 96);
  geometry.rotateX(-Math.PI / 2);

  const litter = [0x9a4a1f, 0xb5541c, 0x8a3a1c, 0xc26a22, 0x7a3b20].map(
    (hex) => new THREE.Color(hex),
  );
  const path = new THREE.Color(0x6e4630);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    color.copy(litter[Math.floor(rng() * litter.length)]);
    // 中央留一條較深的小徑
    const pathWeight = 1 - THREE.MathUtils.smoothstep(Math.abs(x), 1.2, 3.4);
    color.lerp(path, pathWeight * 0.75);
    color.multiplyScalar(range(rng, 0.85, 1.1));
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const ground = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  );
  ground.receiveShadow = true;
  return ground;
}

function createLights() {
  const hemisphere = new THREE.HemisphereLight(0xffe3bd, 0x5a3520, 1.25);

  const sun = new THREE.DirectionalLight(0xffb672, 2.6);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(60);
  sun.target.position.set(0, 0, -8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  const cam = sun.shadow.camera;
  cam.left = -34;
  cam.right = 34;
  cam.top = 34;
  cam.bottom = -34;
  cam.near = 1;
  cam.far = 140;

  // 從鏡頭側補一點暖光，避免逆光下樹冠全黑
  const fill = new THREE.DirectionalLight(0xffd2a8, 0.7);
  fill.position.set(10, 8, 20);

  return [hemisphere, sun, sun.target, fill];
}

/** 建立天空、霧、燈光與地面，全部加入 scene */
export function createEnvironment(scene, rng) {
  scene.fog = new THREE.Fog(FOG_COLOR, 16, 78);
  scene.background = new THREE.Color(FOG_COLOR);
  scene.add(createSky(), createSun(), createGround(rng), ...createLights());
}
