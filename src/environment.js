import * as THREE from 'three';
import { SKY, SUN_DIRECTION } from './palette.js';
import { HAZE_GLSL, createFog } from './atmosphere.js';

// 天空、太陽、霧、燈光與地面。太陽方向與霧色由 palette.js 的同一組設定決定，
// 天空上看到的太陽、平行光、霧的受光方向、後期的光柱都指向同一個地方。

export const sunDirection = new THREE.Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z);

const GROUND_SIZE = 240;
const GROUND_TILE = 4.5; // 一張地表貼圖涵蓋的公尺數

const smooth = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);

/**
 * 地表高度（公尺）。中央小徑保持平坦，兩側林地有緩坡與小起伏。
 * 樹、地面落葉、飄落葉的落點都用這個函式貼齊地面。
 */
export function groundHeight(x, z) {
  const offPath = smooth(Math.abs(x), 1.6, 6);
  const broad =
    Math.sin(x * 0.19 + 1.3) * Math.cos(z * 0.15 + 0.4) * 0.3 + Math.sin(x * 0.07 - z * 0.11) * 0.22;
  const bumps = Math.sin(x * 0.55 + z * 0.37) * 0.08 + Math.sin(z * 0.71 - x * 0.43 + 2) * 0.05;
  return offPath * (broad + bumps + 0.08);
}

/** 地表法線（單位向量），用中央差分從高度函式取得 */
export function groundNormal(x, z, target = new THREE.Vector3()) {
  const e = 0.25;
  return target
    .set(
      groundHeight(x - e, z) - groundHeight(x + e, z),
      2 * e,
      groundHeight(x, z - e) - groundHeight(x, z + e),
    )
    .normalize();
}

function createSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(SKY.top) },
      uMid: { value: new THREE.Color(SKY.mid) },
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
      varying vec3 vDirection;
      ${HAZE_GLSL}
      void main() {
        vec3 dir = normalize(vDirection);
        float h = max(dir.y, 0.0);
        float toSun = max(dot(dir, MAPLE_SUN_DIR), 0.0);

        // 高空：暖色中段過渡到偏冷的天頂
        vec3 sky = mix(uMid, uTop, smoothstep(0.12, 0.7, h)) * 0.95;
        // 地平線附近完全等於霧色，往上指數淡出；地平線以下維持霧色
        vec3 haze = mapleHaze(normalize(vec3(dir.x, h * 0.3, dir.z)));
        vec3 color = mix(sky, haze, exp(-h * 6.5));

        // 太陽：寬光暈 + 小而亮的圓盤（HDR，交給後期的 lens glow 與光柱）
        color += MAPLE_HAZE_SUN * (pow(toSun, 220.0) * 0.9 + pow(toSun, 1600.0) * 4.0);
        color += vec3(1.0, 0.86, 0.62) * smoothstep(0.99955, 0.99975, toSun) * 16.0;

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 48, 24), material);
  sky.name = 'sky';
  return sky;
}

function configureTexture(texture, { color = false, anisotropy = 1 } = {}) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.setScalar(GROUND_SIZE / GROUND_TILE);
  texture.anisotropy = anisotropy;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createGround(rng, { textureSize, anisotropy }) {
  const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 200, 200);
  geometry.rotateX(-Math.PI / 2);

  // 頂點色乘在貼圖上：把掃描的森林地表染成楓紅落葉的暖色，並保留中央較深的小徑
  const litter = new THREE.Color().setRGB(1.5, 0.92, 0.52);
  const ember = new THREE.Color().setRGB(1.65, 0.7, 0.38);
  const moss = new THREE.Color().setRGB(1.05, 0.95, 0.6);
  const path = new THREE.Color().setRGB(0.62, 0.47, 0.37);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, groundHeight(x, z));

    // 兩個尺度的平滑變化，避免整片同一個顏色
    const patch = 0.5 + 0.5 * Math.sin(x * 0.23 + z * 0.17 + 1.7) * Math.sin(z * 0.29 - x * 0.13);
    const fine = 0.5 + 0.5 * Math.sin(x * 0.9 - z * 0.7);
    color.copy(litter).lerp(ember, patch * 0.8).lerp(moss, fine * 0.25);
    const pathWeight = 1 - smooth(Math.abs(x), 1.1, 3.2);
    color.lerp(path, pathWeight * 0.85);
    color.multiplyScalar(0.9 + rng() * 0.2);
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    // 貼圖載入前先用接近貼圖平均值的顏色，載入後改回白色
    color: 0x6b5a34,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });
  // 遠處混入放大的同一張貼圖，打散重複的磚塊感
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
      #ifdef USE_MAP
        vec4 groundNear = texture2D( map, vMapUv );
        vec4 groundFar = texture2D( map, vMapUv * 0.23 + vec2( 0.37, 0.11 ) );
        #ifdef USE_FOG
          float groundBlend = 0.18 + 0.55 * smoothstep( 5.0, 36.0, vFogDepth );
        #else
          float groundBlend = 0.3;
        #endif
        diffuseColor *= mix( groundNear, groundFar, groundBlend );
      #endif
      `,
    );
  };

  const loader = new THREE.TextureLoader();
  const load = (name, options) =>
    loader.loadAsync(`/textures/forest_leaves_02_${name}.jpg`).then((t) => configureTexture(t, options));
  Promise.all([
    load(`diffuse_${textureSize}`, { color: true, anisotropy }),
    load(`nor_gl_${textureSize}`, { anisotropy }),
    load('arm_1k', { anisotropy: Math.min(anisotropy, 4) }),
  ])
    .then(([map, normalMap, arm]) => {
      material.color.set(0xffffff);
      material.map = map;
      material.normalMap = normalMap;
      material.normalScale.setScalar(1.3);
      // ARM：R = AO、G = roughness（B 的 metalness 不使用）
      material.aoMap = arm;
      material.roughnessMap = arm;
      material.needsUpdate = true;
    })
    // 貼圖載不到時維持頂點色地面，場景仍可用
    .catch((error) => console.warn('地表貼圖載入失敗，改用純色地面', error));

  const ground = new THREE.Mesh(geometry, material);
  ground.receiveShadow = true;
  ground.name = 'ground';
  return ground;
}

function createLights({ shadowMapSize }) {
  const hemisphere = new THREE.HemisphereLight(0xffe0bc, 0x6a3d22, 1.15);

  const sun = new THREE.DirectionalLight(0xffb36a, 3.8);
  sun.target.position.set(0, 0, -8);
  sun.position.copy(sun.target.position).addScaledVector(sunDirection, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  // r187 的 PCFShadowMap 已是 Vogel disk 柔邊，radius 決定半影寬度
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.1;
  const cam = sun.shadow.camera;
  cam.left = -34;
  cam.right = 34;
  cam.top = 34;
  cam.bottom = -34;
  cam.near = 1;
  cam.far = 160;

  // 從鏡頭側補一點暖光，避免逆光下樹幹與樹冠全黑
  const fill = new THREE.DirectionalLight(0xffd2a8, 0.75);
  fill.position.set(10, 8, 20);

  return { sun, objects: [hemisphere, sun, sun.target, fill] };
}

/**
 * 建立天空、霧、燈光與地面，全部加入 scene。
 * quality：{ textureSize: '1k' | '2k', anisotropy, shadowMapSize }
 */
export function createEnvironment(scene, rng, quality) {
  scene.fog = createFog();
  scene.background = scene.fog.color.clone();
  const lights = createLights(quality);
  scene.add(createSky(), createGround(rng, quality), ...lights.objects);
  return { sun: lights.sun };
}
