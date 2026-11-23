// 畫質分級：high／mid／low。可用網址參數 ?quality=high|mid|low 指定（給驗收與比較用），
// 沒指定時依裝置猜一個起點，再由 main.js 量幀時間自動往下降（只降不升，避免來回跳動）。

export const TIERS = {
  high: {
    pixelRatioCap: 2,
    dof: true,
    glow: true,
    textureSize: '2k',
    anisotropy: 8,
    barkNormals: true,
    shadowMapSize: 2048,
    fallingLeaves: 380,
    groundLeaves: 9000,
    rays: 'full',
    sparkles: 1,
    // 場景二：水面倒影的 cube map 解析度（0 = 不拍，用天空近似）與神木的葉片數
    envSize: 256,
    giantLeaves: 17000,
  },
  mid: {
    pixelRatioCap: 1.5,
    dof: false,
    glow: true,
    // 中檔：簡化版光柱（1/4 解析度、較少步數）
    rays: 'lite',
    textureSize: '2k',
    anisotropy: 4,
    barkNormals: true,
    shadowMapSize: 2048,
    fallingLeaves: 280,
    groundLeaves: 6000,
    sparkles: 0.6,
    envSize: 128,
    giantLeaves: 12000,
  },
  low: {
    pixelRatioCap: 1.5,
    dof: false,
    glow: false,
    // 低檔（手機）：最簡化的光柱、強度減半，避免整片洗白；陰影圖 2048（只在載入時畫一次）
    rays: 'lite',
    raysIntensity: 0.5,
    textureSize: '1k',
    anisotropy: 2,
    barkNormals: false,
    shadowMapSize: 2048,
    fallingLeaves: 200,
    groundLeaves: 3200,
    sparkles: 0.3,
    // 手機：關掉溪水的環境反射（改用天空與霧色的近似反射）
    envSize: 0,
    giantLeaves: 8000,
  },
};

export const TIER_ORDER = ['high', 'mid', 'low'];

/** 回傳 { tier, forced }；forced 表示由網址指定，不做自動降級 */
export function chooseInitialTier({ isSmallScreen }) {
  const requested = new URLSearchParams(window.location.search).get('quality');
  if (requested && TIERS[requested]) return { tier: requested, forced: true };

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (isSmallScreen || coarse) return { tier: 'low', forced: false };
  const cores = navigator.hardwareConcurrency ?? 8;
  const memory = navigator.deviceMemory ?? 8;
  if (cores <= 4 || memory <= 4) return { tier: 'mid', forced: false };
  return { tier: 'high', forced: false };
}

/**
 * 幀時間監看：每個視窗（預設 2.5 秒）算一次平均，連續兩個視窗都太慢就呼叫 onSlow。
 * 分頁在背景或剛切回來的長幀不計入。
 */
export function createFrameWatch({ onSlow, slowMs = 30, windowMs = 2500, warmupMs = 3000 }) {
  let elapsed = 0;
  let frames = 0;
  let total = 0;
  let strikes = 0;
  let lastAverage = 0;
  return {
    sample(frameMs) {
      if (frameMs > 250) return; // 分頁切換造成的長幀
      total += frameMs;
      if (total < warmupMs) return;
      elapsed += frameMs;
      frames += 1;
      if (elapsed < windowMs) return;
      lastAverage = elapsed / frames;
      strikes = lastAverage > slowMs ? strikes + 1 : 0;
      elapsed = 0;
      frames = 0;
      if (strikes >= 2) {
        strikes = 0;
        onSlow(lastAverage);
      }
    },
    get average() {
      return lastAverage;
    },
  };
}
