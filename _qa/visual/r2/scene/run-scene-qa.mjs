// 場景豐富（雙場景）的功能驗收：不送留言（不受每分鐘 3 則的限制）。
//   node _qa/visual/r2/scene/run-scene-qa.mjs <playwright-core 的路徑> [base URL]
// 檢查：預設場景一、切換鈕、時段鈕只在場景二出現、記住選擇（localStorage）、?scene= 參數、
// 兩個場景共用許願葉且點得開、卡片／表單開著時鏡頭停住、prefers-reduced-motion 不動、
// 切回場景一後大氣設定還原、手機檔關閉水面反射、各檔次的幀時間、沒有 console 錯誤。
import { createRequire } from 'node:module';
import path from 'node:path';

const [corePath, base = 'http://localhost:3100'] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(path.resolve(corePath));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });

const results = [];
const problems = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function newPage(contextOptions = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'zh-TW', ...contextOptions });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`console.${m.type()}: ${m.text().slice(0, 300)}`);
  });
  return { ctx, page };
}
const waitReady = (page) => page.waitForFunction(() => window.__wishWall?.leaves.size > 0 && window.__scenes && !window.__scenes.busy, null, { timeout: 60000 });
const state = (page) =>
  page.evaluate(() => ({
    scene: window.__scenes.current,
    time: window.__scenes.time,
    timeHidden: document.querySelector('.scene-switch__time').hidden,
    pressed: [...document.querySelectorAll('.scene-switch [data-scene]')].map((b) => b.getAttribute('aria-pressed')),
    stored: { scene: localStorage.getItem('maple-season:scene'), time: localStorage.getItem('maple-season:time') },
    leaves: window.__wishWall.leaves.size,
    wishParent: window.__wishWall.leaves.group.parent === window.__visual.activeScene,
    fog: window.__visual.activeScene.fog.density,
  }));
const cameraZ = (page) => page.evaluate(() => window.__visual.activeScene.children.find((c) => c.isCamera)?.position.toArray());
const frameStats = (page, ms = 3000) =>
  page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const times = [];
        let last = performance.now();
        const start = last;
        const tick = (now) => {
          times.push(now - last);
          last = now;
          if (now - start < duration) requestAnimationFrame(tick);
          else resolve(times.reduce((a, b) => a + b, 0) / times.length);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
/** 找一片在畫面中間區域、不被 UI 擋住的許願葉 */
const findLeaf = (page) =>
  page.evaluate(() => {
    const ids = [];
    for (let id = 0; id < 100000 && ids.length < 400; id++) if (window.__wishWall.leaves.has(id)) ids.push(id);
    for (const id of ids) {
      const p = window.__wishWall.leaves.screenPosition(id);
      if (p && p.x > innerWidth * 0.18 && p.x < innerWidth * 0.82 && p.y > innerHeight * 0.15 && p.y < innerHeight * 0.72) {
        const el = document.elementFromPoint(p.x, p.y);
        if (el?.id === 'scene') return { id, ...p };
      }
    }
    return null;
  });

{
  const { ctx, page } = await newPage();
  await page.goto(`${base}/?quality=high`);
  await waitReady(page);
  let s = await state(page);
  check('預設進站 = 場景一', s.scene === 1 && s.pressed[0] === 'true');
  check('場景一不顯示時段切換', s.timeHidden === true);
  const leavesOne = s.leaves;

  await page.click('.scene-switch [data-scene="2"]');
  await page.waitForFunction(() => window.__scenes.current === 2 && !window.__scenes.busy, null, { timeout: 60000 });
  await sleep(1500);
  s = await state(page);
  check('點「場景二」切過去', s.scene === 2 && s.pressed[1] === 'true');
  check('場景二顯示時段切換、預設午後', s.timeHidden === false && s.time === 'afternoon');
  check('記住使用者的選擇（localStorage）', s.stored.scene === '2');
  check('兩個場景共用同一份許願葉', s.leaves === leavesOne && s.wishParent, `${s.leaves} 片`);
  const fps2 = await frameStats(page);
  console.log(`      場景二 high 平均幀時間 ${fps2.toFixed(1)} ms`);

  // 鏡頭在推軌（會動）
  const a = await cameraZ(page);
  await sleep(1500);
  const b = await cameraZ(page);
  check('場景二首頁鏡頭緩慢移動', Math.hypot(a[0] - b[0], a[2] - b[2]) > 0.003, `${Math.hypot(a[0] - b[0], a[2] - b[2]).toFixed(3)} m／1.5 s`);

  // 點許願葉 → 卡片；卡片開著時鏡頭停住
  const leaf = await findLeaf(page);
  if (leaf) {
    await page.mouse.click(leaf.x, leaf.y);
    await sleep(1200);
    const opened = await page.evaluate(() => document.getElementById('wish-card-dialog').open);
    check('場景二點許願葉開得了卡片', opened, `id ${leaf.id}`);
    const c1 = await cameraZ(page);
    await sleep(2000);
    const c2 = await cameraZ(page);
    check('卡片開著時鏡頭停住', Math.hypot(c1[0] - c2[0], c1[2] - c2[2]) < 0.004, `${Math.hypot(c1[0] - c2[0], c1[2] - c2[2]).toFixed(4)} m`);
    await page.keyboard.press('Escape');
    await sleep(600);
  } else check('場景二點許願葉開得了卡片', false, '找不到可點的許願葉');

  // 表單開著時也停住
  await page.click('#wish-open');
  await sleep(800);
  const f1 = await cameraZ(page);
  await sleep(2000);
  const f2 = await cameraZ(page);
  check('表單開著時鏡頭停住', Math.hypot(f1[0] - f2[0], f1[2] - f2[2]) < 0.004);
  await page.keyboard.press('Escape');
  await sleep(500);

  // 時段
  for (const t of ['dusk', 'night', 'afternoon', 'night']) {
    await page.click(`.scene-switch [data-time="${t}"]`);
    await page.waitForFunction((time) => window.__scenes.time === time && !window.__scenes.busy, t, { timeout: 20000 });
  }
  s = await state(page);
  check('切換時段（午後／黃昏／夜晚）', s.time === 'night' && s.stored.time === 'night');

  // 重新載入：還是場景二、夜晚
  await page.reload();
  await waitReady(page);
  await page.waitForFunction(() => window.__scenes.current === 2, null, { timeout: 60000 });
  s = await state(page);
  check('重新載入後記得場景二與時段', s.scene === 2 && s.time === 'night');

  // 切回場景一
  await page.click('.scene-switch [data-scene="1"]');
  await page.waitForFunction(() => window.__scenes.current === 1 && !window.__scenes.busy, null, { timeout: 30000 });
  s = await state(page);
  check('切回場景一', s.scene === 1 && s.timeHidden && s.stored.scene === '1');
  const atmosphere = await page.evaluate(() => window.__visual.renderer.toneMappingExposure);
  check('場景一的曝光還原', Math.abs(atmosphere - 0.92) < 1e-6, String(atmosphere));
  const leaf1 = await findLeaf(page);
  if (leaf1) {
    await page.mouse.click(leaf1.x, leaf1.y);
    await sleep(1200);
    check('切回場景一後點許願葉開得了卡片', await page.evaluate(() => document.getElementById('wish-card-dialog').open));
    await page.keyboard.press('Escape');
  }

  // 網址參數優先
  await page.goto(`${base}/?quality=high&scene=2&time=dusk`);
  await waitReady(page);
  await page.waitForFunction(() => window.__scenes.current === 2, null, { timeout: 60000 });
  s = await state(page);
  check('?scene=2&time=dusk 直接進場景二黃昏', s.scene === 2 && s.time === 'dusk');
  await ctx.close();
}

// 各檔次的幀時間（headless；只是相對比較用）
for (const q of ['high', 'mid', 'low']) {
  const { ctx, page } = await newPage({ deviceScaleFactor: 2 });
  await page.goto(`${base}/?quality=${q}&scene=1`);
  await waitReady(page);
  await sleep(3000);
  const one = await frameStats(page);
  await page.evaluate(() => window.__scenes.switchTo(2));
  await sleep(4000);
  const two = await frameStats(page);
  console.log(`      ${q}（1440×900 @2×）場景一 ${one.toFixed(1)} ms／場景二 ${two.toFixed(1)} ms`);
  await ctx.close();
}

// 自動降級（沒有強制檔次）在場景二仍會作動：用 CPU 節流讓它變慢
{
  const { ctx, page } = await newPage({ deviceScaleFactor: 2 });
  await page.goto(`${base}/?scene=2`);
  await waitReady(page);
  await page.waitForFunction(() => window.__scenes.current === 2 && !window.__scenes.busy, null, { timeout: 60000 });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const before = await page.evaluate(() => window.__visual.tier);
  await sleep(16000);
  const after = await page.evaluate(() => window.__visual.info());
  check('場景二的自動降級仍會作動', after.tier !== before || after.auxScale < 1, `${before} → ${after.tier}（aux ${after.auxScale}）`);
  await ctx.close();
}

// 手機：初始自動選 mid
{
  const { ctx, page } = await newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  // 保存渲染迴圈開始前的初始檔次，不受場景載入期間自動降級影響。
  await page.addInitScript(() => {
    Object.defineProperty(window, '__visual', {
      configurable: true,
      set(value) {
        window.__qaInitialQuality = { ...value.info(), pixelRatio: value.pixelRatio };
        Object.defineProperty(window, '__visual', { value, writable: true, configurable: true });
      },
    });
  });
  await page.goto(`${base}/?scene=2`);
  await waitReady(page);
  await page.waitForFunction(() => window.__scenes.current === 2 && !window.__scenes.busy, null, { timeout: 60000 });
  const info = await page.evaluate(() => window.__qaInitialQuality);
  check('手機初始自動選 mid', info.tier === 'mid' && !info.forced && info.glow && !info.dof && info.rays === 'lite' && info.pixelRatio <= 1.5, info.tier);
  const switchBox = await page.evaluate(() => {
    const a = document.querySelector('.scene-switch').getBoundingClientRect();
    const b = document.getElementById('wish-open').getBoundingClientRect();
    return { overlap: !(a.bottom < b.top || a.top > b.bottom || a.right < b.left || a.left > b.right), width: a.width };
  });
  check('手機上切換鈕不擋「留下你的楓葉」', !switchBox.overlap, `寬 ${switchBox.width.toFixed(0)} px`);
  const leaf = await findLeaf(page);
  if (leaf) {
    await page.touchscreen.tap(leaf.x, leaf.y);
    await sleep(1200);
    check('手機場景二觸控開卡片', await page.evaluate(() => document.getElementById('wish-card-dialog').open));
  }
  await ctx.close();
}

// prefers-reduced-motion：場景二鏡頭不動
{
  const { ctx, page } = await newPage({ reducedMotion: 'reduce' });
  await page.goto(`${base}/?quality=mid&scene=2`);
  await waitReady(page);
  await page.waitForFunction(() => window.__scenes.current === 2 && !window.__scenes.busy, null, { timeout: 60000 });
  await sleep(2500);
  const a = await cameraZ(page);
  await sleep(2500);
  const b = await cameraZ(page);
  check('prefers-reduced-motion 時場景二鏡頭不動', Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-4);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通過`);
console.log(problems.length ? `console 問題：\n${[...new Set(problems)].join('\n')}` : '沒有 console 錯誤／警告');
process.exit(failed ? 1 : 0);
