import * as THREE from 'three';
import { HAZE_GLSL, atmosphereUniforms } from '../atmosphere.js';

// 場景二的天空：天頂到地平線的漸層（地平線完全等於霧色，和場景一同一個 mapleHaze）、
// 太陽圓盤與光暈、少量薄雲；夜晚有月亮（圓盤 + 淡淡的月海 + 光暈）與星星。
// 所有參數都是 uniform，時段切換時直接改值。

export function createSky2() {
  const uniforms = {
    ...atmosphereUniforms,
    uZenith: { value: new THREE.Color() },
    uUpper: { value: new THREE.Color() },
    uSunDisc: { value: new THREE.Color() },
    uSunGlow: { value: 0.5 },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoon: { value: 0 },
    uStars: { value: 0 },
    uClouds: { value: 0 },
    uCloudColor: { value: new THREE.Color(1, 1, 1) },
  };
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uUpper;
      uniform vec3 uSunDisc;
      uniform float uSunGlow;
      uniform vec3 uMoonDir;
      uniform float uMoon;
      uniform float uStars;
      uniform float uClouds;
      uniform vec3 uCloudColor;
      varying vec3 vDirection;
      ${HAZE_GLSL}
      float skyHash( vec3 p ) {
        p = fract( p * vec3( 443.897, 441.423, 437.195 ) );
        p += dot( p, p.yzx + 19.19 );
        return fract( ( p.x + p.y ) * p.z );
      }
      float skyNoise( vec2 p ) {
        vec2 i = floor( p );
        vec2 f = fract( p );
        f = f * f * ( 3.0 - 2.0 * f );
        float a = skyHash( vec3( i, 1.0 ) );
        float b = skyHash( vec3( i + vec2( 1.0, 0.0 ), 1.0 ) );
        float c = skyHash( vec3( i + vec2( 0.0, 1.0 ), 1.0 ) );
        float d = skyHash( vec3( i + vec2( 1.0, 1.0 ), 1.0 ) );
        return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
      }
      void main() {
        vec3 dir = normalize( vDirection );
        float h = max( dir.y, 0.0 );
        vec3 sky = mix( uUpper, uZenith, smoothstep( 0.08, 0.75, h ) );
        vec3 haze = mapleHaze( normalize( vec3( dir.x, h * 0.3, dir.z ) ) );
        vec3 color = mix( sky, haze, exp( - h * 5.5 ) );

        // 薄雲：投到天空平面上的雜訊，地平線附近淡掉
        if ( uClouds > 0.0 && dir.y > 0.02 ) {
          vec2 q = dir.xz / ( dir.y + 0.12 ) * 1.6;
          float n = skyNoise( q ) * 0.55 + skyNoise( q * 2.3 + 3.7 ) * 0.3 + skyNoise( q * 5.1 ) * 0.15;
          float cloud = smoothstep( 0.52, 0.78, n ) * smoothstep( 0.02, 0.25, dir.y ) * uClouds;
          float toSun = max( dot( dir, MAPLE_SUN_DIR ), 0.0 );
          color = mix( color, uCloudColor * ( 0.8 + 0.8 * pow( toSun, 8.0 ) ), cloud );
        }

        // 太陽：圓盤 + 光暈
        float toSun = max( dot( dir, MAPLE_SUN_DIR ), 0.0 );
        color += MAPLE_HAZE_SUN * ( pow( toSun, 300.0 ) * 0.6 + pow( toSun, 1600.0 ) * 1.6 ) * uSunGlow;
        color += uSunDisc * smoothstep( 0.99945, 0.99985, toSun );

        // 月亮：圓盤、月海、光暈
        if ( uMoon > 0.0 ) {
          float toMoon = dot( dir, uMoonDir );
          float disc = smoothstep( 0.99955, 0.99975, toMoon );
          vec3 side = normalize( cross( uMoonDir, vec3( 0.0, 1.0, 0.0 ) ) );
          vec3 up = cross( side, uMoonDir );
          vec2 m = vec2( dot( dir, side ), dot( dir, up ) ) * 45.0;
          float maria = skyNoise( m * 2.0 + 3.0 ) * 0.6 + skyNoise( m * 5.0 ) * 0.4;
          vec3 moonColor = vec3( 1.0, 0.97, 0.9 ) * ( 0.75 + 0.35 * smoothstep( 0.35, 0.7, maria ) );
          color = mix( color, moonColor * 3.2 * uMoon, disc );
          color += vec3( 0.55, 0.65, 0.9 ) * ( pow( max( toMoon, 0.0 ), 600.0 ) * 0.5 + pow( max( toMoon, 0.0 ), 40.0 ) * 0.06 ) * uMoon;
        }

        // 星星：天空方向切成小格，每格少數亮點，地平線附近淡掉
        if ( uStars > 0.0 && dir.y > 0.0 ) {
          vec3 cell = floor( dir * 220.0 );
          float r = skyHash( cell );
          vec3 center = ( cell + 0.5 ) / 220.0;
          float d = length( dir - normalize( center ) ) * 220.0;
          float star = step( 0.985, r ) * smoothstep( 0.6, 0.0, d ) * ( 0.4 + 0.6 * skyHash( cell + 7.0 ) );
          color += vec3( 0.85, 0.9, 1.0 ) * star * uStars * smoothstep( 0.05, 0.3, dir.y );
        }

        gl_FragColor = vec4( color, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(200, 64, 32), material);
  mesh.name = 'sky-2';
  return { mesh, uniforms };
}
