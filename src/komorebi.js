import { SUN_DIRECTION } from './palette.js';

// 木漏れ日（komorebi）：樹葉縫隙灑在地上的斑駁光斑。
// 真正的樹冠陰影來自陰影貼圖；這裡再疊一層「動態 cookie」：把地面上的點沿太陽方向
// 投到樹冠高度，在那個平面上取程序化雜訊當作葉縫，隨風輕微晃動。
// 低角度的太陽讓光斑沿光線方向拉長成橢圓，和真實的林間光斑一樣。
// cover（0..1）是那個點抬頭沿太陽方向看上去有沒有樹冠，沒有樹冠的地方不做光斑。

const f = (n) => n.toFixed(5);

export const komorebiUniforms = {
  uKomorebiTime: { value: 0 },
};

export const KOMOREBI_GLSL = /* glsl */ `
  uniform float uKomorebiTime;
  const vec3 KOMOREBI_SUN = vec3( ${f(SUN_DIRECTION.x)}, ${f(SUN_DIRECTION.y)}, ${f(SUN_DIRECTION.z)} );
  float komorebiHash( vec2 p ) {
    p = fract( p * vec2( 123.34, 456.21 ) );
    p += dot( p, p + 45.32 );
    return fract( p.x * p.y );
  }
  float komorebiNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 u = fract( p );
    u = u * u * ( 3.0 - 2.0 * u );
    return mix( mix( komorebiHash( i ), komorebiHash( i + vec2( 1.0, 0.0 ) ), u.x ),
                mix( komorebiHash( i + vec2( 0.0, 1.0 ) ), komorebiHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
  }
  // 葉縫圖樣：0..1，sharp 越大斑點越小越銳利
  float komorebiGaps( vec3 worldPos, float threshold ) {
    vec2 q = worldPos.xz + KOMOREBI_SUN.xz * ( ( 4.2 - worldPos.y ) / KOMOREBI_SUN.y );
    float t = uKomorebiTime;
    // 樹葉隨風晃動：葉縫的位置小幅來回擺動，不是整片平移
    vec2 sway = vec2( sin( t * 0.9 + q.y * 0.35 ), cos( t * 0.7 + q.x * 0.31 ) ) * 0.08;
    vec2 p = q * 2.6 + sway;
    float gaps = komorebiNoise( p ) * 0.6 + komorebiNoise( p * 2.4 + 7.1 + sway * 2.0 ) * 0.4;
    return smoothstep( threshold, threshold + 0.08, gaps );
  }
  /**
   * 太陽直射光（已含陰影）換成有光斑的版本。
   * lit：已含陰影的光；open：沒有陰影時的光（太陽本身的顏色）；cover：抬頭是否有樹冠。
   * 照得到的地方：葉影把光打散成斑駁的一塊一塊；
   * 樹冠陰影裡：從葉縫漏下來的小光斑（太陽的針孔成像，沿光線方向拉長）。
   */
  vec3 komorebi( vec3 worldPos, vec3 lit, vec3 open, float cover ) {
    if ( cover < 0.01 ) return lit;
    float dapple = mix( 0.3, 1.5, komorebiGaps( worldPos, 0.5 ) );
    vec3 spots = open * komorebiGaps( worldPos + vec3( 3.7, 0.0, 1.3 ), 0.72 ) * 0.9;
    vec3 shade = max( open - lit, vec3( 0.0 ) );
    float shaded = dot( shade, vec3( 0.333 ) ) / max( dot( open, vec3( 0.333 ) ), 1e-4 );
    return mix( lit, lit * dapple + spots * shaded, cover );
  }
`;
