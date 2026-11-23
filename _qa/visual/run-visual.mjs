// 視覺升級驗收（headless Chrome）。playwright-core 不是專案相依套件，路徑由參數傳入：
//   node _qa/visual/run-visual.mjs <playwright-core 的路徑> [base URL]
// 需要服務已在跑（npm run build && npm start），且該 IP 這一分鐘內送出的留言少於 3 則（腳本會送 1 則）。
// 截圖寫在本目錄（_qa/visual/）。
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [corePath, base = 'http://localhost:3000'] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(path.resolve(corePath));
// 截圖預設寫在本目錄；設 QA_OUT 可改寫到別處（例如 _qa/visual/fix1，不覆蓋既有截圖）
const out = process.env.QA_OUT ? path.resolve(process.env.QA_OUT) : path.dirname(fileURLToPath(import.meta.url));
const shot = (page, name) => page.screenshot({ path: path.join(out, name) });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
const problems = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
function watch(page, label) {
  page.on('pageerror', (error) => problems.push(`${label} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`${label} console.${message.type()}: ${message.text().slice(0, 300)}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`${label} HTTP ${response.status()} ${response.url()}`);
  });
}

async function open(browser, label, query, context = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-TW', ...context });
  const page = await ctx.newPage();
  watch(page, label);
  await page.goto(`${base}/${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__wishWall?.leaves.size > 0);
  await sleep(5000);
  return { ctx, page };
}

/** 用 requestAnimationFrame 量 4 秒的平均幀時間（headless 受 60 Hz 限制，16.7 ms 即為上限） */
const frameStats = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const times = [];
        let last = performance.now();
        const start = last;
        const tick = (now) => {
          times.push(now - last);
          last = now;
          if (now - start < 4000) requestAnimationFrame(tick);
          else {
            times.sort((a, b) => a - b);
            const mean = times.reduce((sum, t) => sum + t, 0) / times.length;
            resolve({ meanMs: +mean.toFixed(2), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(2), fps: Math.round(1000 / mean) });
          }
        };
        requestAnimationFrame(tick);
      }),
  );

const visual = (page) =>
  page.evaluate(() => {
    const canvas = document.getElementById('scene');
    return {
      ...window.__visual.info(),
      lens: window.__visual.lens,
      pixelRatio: window.__visual.pixelRatio,
      canvas: [canvas.width, canvas.height],
      css: [canvas.clientWidth, canvas.clientHeight],
    };
  });
const report = (label, info, stats) =>
  console.log(
    `      ${label}: tier=${info.tier} dof=${info.dof} glow=${info.glow} rays=${info.rays} msaa=${info.msaa} ` +
      `pixelRatio=${info.pixelRatio} canvas=${info.canvas.join('x')} dofBuffer=${info.dofSize.join('x')} ` +
      `${info.lens.focalLength.toFixed(1)}mm fov=${info.lens.fov.toFixed(1)}° focus=${info.lens.focus.toFixed(2)}m` +
      (stats ? ` | ${stats.meanMs} ms/幀 (p95 ${stats.p95Ms})，約 ${stats.fps} fps` : ''),
  );
const cardOpen = (page) => page.evaluate(() => document.getElementById('wish-card-dialog').open);
const leafPosition = (page, id) => page.evaluate((wishId) => window.__wishWall.leaves.screenPosition(wishId), id);

const browser = await chromium.launch({ channel: 'chrome', headless: true });

// ---------- 桌面高檔 ----------
{
  const { ctx, page } = await open(browser, 'high', '?quality=high');
  const info = await visual(page);
  const stats = await frameStats(page);
  report('桌面 high', info, stats);
  check('high：後期管線啟用，DOF／glow／光柱皆開', info.supported && info.dof && info.glow && info.rays);
  check('high：backing store = CSS 尺寸 × pixel ratio（2×）', info.canvas[0] === info.css[0] * 2 && info.canvas[1] === info.css[1] * 2 && info.scene[0] === info.canvas[0], `${info.canvas} / ${info.css}`);
  check('high：鏡頭 35 mm（36 mm 16:9 片門 → 垂直視角 32.3°）', Math.abs(info.lens.focalLength - 35) < 0.01 && Math.abs(info.lens.fov - 32.27) < 0.05);
  check('high：對焦在許願葉深度（7–26 m 之間）', info.lens.focus > 7 && info.lens.focus < 26, `${info.lens.focus.toFixed(2)} m`);
  await shot(page, '01-desktop-default.png');

  await page.getByRole('button', { name: '留下你的楓葉' }).click();
  await page.locator('#wish-nickname').fill('視覺驗收');
  await page.locator('#wish-message').fill('升級後的楓林，願望一樣看得清楚 🍁');
  const [postResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/wishes') && response.request().method() === 'POST'),
    page.getByRole('button', { name: '讓楓葉飄落' }).click(),
  ]);
  const posted = await postResponse.json();
  check('high：表單送出成功（201）', postResponse.status() === 201, `id=${posted.wish?.id}`);
  await sleep(8500);
  await shot(page, '02-desktop-wish-settled.png');

  const restFocus = (await visual(page)).lens.focus;
  let position = await leafPosition(page, posted.wish.id);
  await page.mouse.move(position.x, position.y);
  await sleep(200);
  check('high：2× backing store 下滑到許願葉游標變手指', (await page.evaluate(() => document.getElementById('scene').style.cursor)) === 'pointer');
  position = await leafPosition(page, posted.wish.id);
  await page.mouse.click(position.x, position.y);
  await sleep(2500);
  const message = await page.evaluate(() => document.getElementById('wish-card-message').textContent);
  check('high：點許願葉開卡片，內容正確', (await cardOpen(page)) && message === posted.wish.message, message);
  const pulledFocus = (await visual(page)).lens.focus;
  check('high：開卡片時焦點拉近到被選中的葉子（6–9 m）', pulledFocus > 6 && pulledFocus < 9 && pulledFocus < restFocus, `${restFocus.toFixed(2)} → ${pulledFocus.toFixed(2)} m`);
  await shot(page, '03-desktop-card.png');
  await page.keyboard.press('Escape');
  await sleep(2500);
  const backFocus = (await visual(page)).lens.focus;
  check('high：關卡片後回到預設焦點', Math.abs(backFocus - restFocus) < 0.4, `${backFocus.toFixed(2)} m`);
  await page.mouse.click(6, 6);
  await sleep(300);
  check('high：點沒有楓葉的地方不會開卡片', !(await cardOpen(page)));
  await ctx.close();
}

// ---------- 桌面中檔（關景深對照）----------
{
  const { ctx, page } = await open(browser, 'mid', '?quality=mid');
  const info = await visual(page);
  report('桌面 mid', info, await frameStats(page));
  check('mid：DOF 與光柱關閉、glow 保留、pixel ratio ≤ 1.5', !info.dof && !info.rays && info.glow && info.pixelRatio <= 1.5);
  await shot(page, '04-desktop-dof-off-or-mid.png');
  await ctx.close();
}

// ---------- 手機（390x844、觸控，自動選檔）----------
{
  const { ctx, page } = await open(browser, 'mobile', '', {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  // 模擬較慢的手機 CPU（4× 降速）；GPU 仍是本機的，數字只能當相對參考
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await sleep(1000);
  const info = await visual(page);
  report('手機模擬（CPU 4× 降速）', info, await frameStats(page));
  check('手機：自動選 low、DOF／glow／光柱關閉、pixel ratio ≤ 1.5', info.tier === 'low' && !info.dof && !info.glow && !info.rays && info.pixelRatio <= 1.5);
  check('手機：後期仍做 tone mapping（管線啟用）', info.supported);
  await shot(page, '05-mobile-default.png');

  await page.getByRole('button', { name: '留下你的楓葉' }).tap();
  await sleep(500);
  await page.locator('#wish-nickname').fill('手機訪客');
  await page.locator('#wish-message').fill('用手機也能留下楓葉');
  const box = await page.locator('#wish-form').boundingBox();
  check('手機：表單完整落在畫面內且可輸入', box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844 && (await page.locator('#wish-message').inputValue()) === '用手機也能留下楓葉');
  await shot(page, '06-mobile-form.png');
  await page.getByRole('button', { name: '取消' }).tap();
  await sleep(300);

  const target = await page.evaluate(async () => {
    const data = await (await fetch('/api/wishes?limit=100')).json();
    return data.wishes
      .map((wish) => ({ id: wish.id, ...window.__wishWall.leaves.screenPosition(wish.id) }))
      .find((p) => p.y > 480 && p.y < 640 && p.x > 30 && p.x < innerWidth - 30);
  });
  const now = await leafPosition(page, target.id);
  await page.touchscreen.tap(now.x, now.y);
  await sleep(900);
  check('手機：觸控點許願葉開卡片並維持開啟', await cardOpen(page));
  await ctx.close();
}

// ---------- 桌面低檔 ----------
{
  const { ctx, page } = await open(browser, 'low', '?quality=low');
  const info = await visual(page);
  report('桌面 low', info, await frameStats(page));
  check('low：只留 tone mapping，其餘後期關閉', info.supported && !info.dof && !info.glow && !info.rays);
  await shot(page, '07-desktop-low.png');
  await ctx.close();
}

// ---------- 自動降級：把 CPU 降速到很慢，確認會自己往下換檔而且許願葉還點得到 ----------
{
  const { ctx, page } = await open(browser, 'auto', '');
  const before = (await visual(page)).tier;
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
  await sleep(26000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await sleep(1500);
  const info = await visual(page);
  report(`自動降級（起點 ${before}，CPU 20× 降速 26 秒後）`, info);
  check('自動降級：幀時間過長時會往下換檔', before === 'high' && (info.tier !== 'high' || info.auxScale < 1), `${before} → ${info.tier} auxScale=${info.auxScale}`);
  const leaf = await page.evaluate(async () => {
    const data = await (await fetch('/api/wishes?limit=100')).json();
    return data.wishes
      .map((wish) => ({ id: wish.id, ...window.__wishWall.leaves.screenPosition(wish.id) }))
      .find((p) => (p.x < 400 || p.x > 1040) && p.x > 40 && p.x < 1400 && p.y > 80 && p.y < 650);
  });
  const now = await leafPosition(page, leaf.id);
  await page.mouse.click(now.x, now.y);
  await sleep(700);
  check('自動降級：換檔（pixel ratio 改變）後點擊熱區仍正確', await cardOpen(page));
  await shot(page, '08-desktop-auto-degraded.png');
  await ctx.close();
}

// ---------- prefers-reduced-motion ----------
{
  const { ctx, page } = await open(browser, 'reduced', '?quality=high', { reducedMotion: 'reduce' });
  const info = await visual(page);
  const state = await page.evaluate(() => ({ leaves: window.__wishWall.leaves.size }));
  check('減少動態：許願葉仍會浮現（不是空林子）', info.reducedMotion && state.leaves > 0, `${state.leaves} 片`);
  // 鏡頭不漂移、不跟滑鼠：移動滑鼠後許願葉的「家」位置投影不應整體平移
  const sample = async () => page.evaluate(() => window.__visual.lens.focus);
  await page.mouse.move(100, 100);
  await sleep(600);
  await page.mouse.move(1300, 800);
  await sleep(600);
  check('減少動態：對焦穩定（無選取時不變動）', Math.abs((await sample()) - info.lens.focus) < 0.05);
  await shot(page, '09-desktop-reduced-motion.png');
  await ctx.close();
}

await browser.close();

console.log('');
const unexpected = problems.filter((line) => !/HTTP 400/.test(line));
if (unexpected.length) console.log(`頁面警告／錯誤：\n  ${unexpected.join('\n  ')}`);
else console.log('頁面沒有 console.error／warning、未捕捉例外或失敗請求');
const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} 項通過`);
process.exit(failed.length || unexpected.length ? 1 : 0);
