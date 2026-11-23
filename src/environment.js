import * as THREE from 'three';
import { SKY, SUN_DIRECTION } from './palette.js';
import { HAZE_GLSL, atmosphereUniforms, createFog } from './atmosphere.js';
import { KOMOREBI_GLSL, komorebiUniforms } from './komorebi.js';

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
      ...atmosphereUniforms,
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

        // 太陽：收斂的光暈 + 小圓盤（HDR，交給後期的 lens glow）。
        // 第二輪：太陽藏在樹冠邊緣後面，圓盤縮小、亮度壓低，不再整團過曝
        color += MAPLE_HAZE_SUN * (pow(toSun, 300.0) * 0.55 + pow(toSun, 1600.0) * 1.6);
        color += vec3(1.0, 0.84, 0.6) * smoothstep(0.9994, 0.99985, toSun) * 2.2;

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

// 樹下的陰暗（AO）與樹冠覆蓋率預先算進一張小貼圖：R = AO，G = 落葉堆積量，B = 沿太陽方向看上去有樹冠的程度
const FLOOR_MAP = { xMin: -42, zMin: -72, size: 96, resolution: 384 };
const CROWN_HEIGHT = 3.5; // 樹冠中心高度（模型座標，乘上每棵樹的大小）
const CROWN_RADIUS = 2.5;

function createFloorMap(trees, litterSpots) {
  const { resolution: n, size, xMin, zMin } = FLOOR_MAP;
  const data = new Uint8Array(n * n * 4);
  const cell = size / n;
  for (let j = 0; j < n; j++) {
    const z = zMin + (j + 0.5) * cell;
    for (let i = 0; i < n; i++) {
      const x = xMin + (i + 0.5) * cell;
      let ao = 1;
      let cover = 0;
      // 沿太陽方向往上投到樹冠高度的位置（光斑只出現在「抬頭看得到樹冠」的地方）
      for (const t of trees) {
        const dx = x - t.x;
        const dz = z - t.z;
        const d2 = dx * dx + dz * dz;
        const s = t.scale;
        // 樹冠正下方的大範圍遮蔽 + 樹根附近的接觸陰影
        ao *= 1 - 0.5 * Math.exp(-d2 / (2 * (1.9 * s) ** 2));
        ao *= 1 - 0.7 * Math.exp(-d2 / (2 * (0.6 * s) ** 2));
        const lift = (CROWN_HEIGHT * s) / SUN_DIRECTION.y;
        const cx = x + SUN_DIRECTION.x * lift - t.x;
        const cz = z + SUN_DIRECTION.z * lift - t.z;
        cover = Math.max(cover, Math.exp(-(cx * cx + cz * cz) / (2 * (CROWN_RADIUS * s * 0.8) ** 2)));
      }
      let litter = 0;
      for (const spot of litterSpots) {
        const dx = x - spot.x;
        const dz = z - spot.z;
        litter = Math.max(litter, Math.exp(-(dx * dx + dz * dz) / (2 * spot.radius ** 2)) * spot.amount);
      }
      const k = (j * n + i) * 4;
      data[k] = Math.round(Math.max(ao, 0.25) * 255);
      data[k + 1] = Math.round(Math.min(litter, 1) * 255);
      data[k + 2] = Math.round(Math.min(cover * 1.25, 1) * 255);
      data[k + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, n, n);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createGround(rng, { textureSize, anisotropy }, { trees, litterSpots }) {
  const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 200, 200);
  geometry.rotateX(-Math.PI / 2);

  // 頂點色乘在貼圖上：把掃描的森林地表染成楓紅落葉的暖色，並保留中央較深的小徑
  const litter = new THREE.Color().setRGB(1.3, 0.82, 0.5);
  const ember = new THREE.Color().setRGB(1.45, 0.62, 0.36);
  const moss = new THREE.Color().setRGB(0.95, 0.9, 0.6);
  const path = new THREE.Color().setRGB(0.6, 0.47, 0.38);
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
  const floorMap = createFloorMap(trees, litterSpots);
  // 遠處混入放大的同一張貼圖，打散重複的磚塊感；樹下 AO、落葉堆、葉縫光斑（komorebi）
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, komorebiUniforms, { uFloorMap: { value: floorMap } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vGroundWorld;
        uniform sampler2D uFloorMap;
        vec4 groundFloor;
        ${KOMOREBI_GLSL}`,
      )
      .replace(
        '#include <lights_physical_pars_fragment>',
        /* glsl */ `#include <lights_physical_pars_fragment>
        // 只對太陽（與太陽同方向的那盞平行光）乘上葉縫光斑
        void RE_Direct_Ground( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
          IncidentLight light = directLight;
          vec3 sunView = normalize( ( viewMatrix * vec4( KOMOREBI_SUN, 0.0 ) ).xyz );
          #if NUM_DIR_LIGHTS > 0
            // 會投影的光排在最前面：0 號就是太陽，它的 color 是沒有被陰影遮掉的原始光
            if ( dot( light.direction, sunView ) > 0.999 ) light.color = komorebi( vGroundWorld, light.color, directionalLights[ 0 ].color, groundFloor.b );
          #endif
          RE_Direct_Physical( light, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Ground`,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        // 樹下 AO：環境光（天空、反射）被樹冠擋掉大半
        reflectedLight.indirectDiffuse *= groundFloor.r * groundFloor.r;`,
      )
      .replace(
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
      groundFloor = texture2D( uFloorMap, ( vGroundWorld.xz - vec2( ${FLOOR_MAP.xMin.toFixed(1)}, ${FLOOR_MAP.zMin.toFixed(1)} ) ) / ${FLOOR_MAP.size.toFixed(1)} );
      if ( any( lessThan( vGroundWorld.xz, vec2( ${FLOOR_MAP.xMin.toFixed(1)}, ${FLOOR_MAP.zMin.toFixed(1)} ) ) ) ||
           any( greaterThan( vGroundWorld.xz, vec2( ${(FLOOR_MAP.xMin + FLOOR_MAP.size).toFixed(1)}, ${(FLOOR_MAP.zMin + FLOOR_MAP.size).toFixed(1)} ) ) ) ) {
        groundFloor = vec4( 1.0, 0.0, 0.0, 1.0 );
      }
      // 樹下較暗；落葉堆積處偏深紅、較暗（一叢一叢的）
      diffuseColor.rgb *= mix( 0.55, 1.0, groundFloor.r );
      diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.05, 0.55, 0.38 ), groundFloor.g * 0.6 );
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
      // 低角度看過去法線太強會變成沙丘般的波紋
      material.normalScale.setScalar(0.55);
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
  // 第二輪：環境光大幅降低，讓樹冠內部與背光面真的暗下來；直射的太陽加強，亮暗對比交給它
  const hemisphere = new THREE.HemisphereLight(0xffd6ae, 0x3a2416, 0.5);

  const sun = new THREE.DirectionalLight(0xffb066, 5.2);
  sun.target.position.set(0, 0, -8);
  sun.position.copy(sun.target.position).addScaledVector(sunDirection, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  // r187 的 PCFShadowMap 已是 Vogel disk 柔邊，radius 決定半影寬度
  sun.shadow.radius = shadowMapSize > 2048 ? 5 : 2.5;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.06;
  const cam = sun.shadow.camera;
  cam.left = -34;
  cam.right = 34;
  cam.top = 34;
  cam.bottom = -34;
  cam.near = 1;
  cam.far = 160;

  // 從鏡頭側補一點點暖光，逆光下樹幹與樹冠保留暗部細節但不會被打平
  const fill = new THREE.DirectionalLight(0xffd2a8, 0.18);
  fill.position.set(10, 8, 20);

  return { sun, objects: [hemisphere, sun, sun.target, fill] };
}

/**
 * 建立天空、霧、燈光與地面，全部加入 scene。
 * quality：{ textureSize: '1k' | '2k', anisotropy, shadowMapSize }
 * forest：{ trees: [{ x, z, scale }], litterSpots: [{ x, z, radius, amount }] }（樹下 AO 與落葉堆）
 */
export function createEnvironment(scene, rng, quality, forest) {
  scene.fog = createFog();
  scene.background = scene.fog.color.clone();
  const lights = createLights(quality);
  scene.add(createSky(), createGround(rng, quality, forest), ...lights.objects);
  return { sun: lights.sun };
}
