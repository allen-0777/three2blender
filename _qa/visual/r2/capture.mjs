// 第二輪視覺驗收：6 個固定鏡頭（不送留言、不受率限影響）。
//   node _qa/visual/r2/capture.mjs <playwright-core 的路徑> <base URL> <輸出目錄> [前綴]
// 需要服務已在跑。新舊版都要有 window.__visual.setPose（舊版比對時另外補上同一個 hook）。
// 截圖：<前綴>01-home.png … <前綴>06-mobile.png；另印出每個鏡頭的幀時間。
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const [corePath, base = 'http://localhost:3100', outDir = '.', prefix = ''] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(path.resolve(corePath));
mkdirSync(outDir, { recursive: true });
const file = (name) => path.join(outDir, `${prefix}${name}.png`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quality = process.env.QA_QUALITY ?? 'high';

// 低角度仰望樹冠、地面近景
export const POSES = {
  up: { position: [0.5, 0.4, 2.0], target: [0.17, 3.82, -7.39] },
  ground: { position: [-1.6, 1.1, -3.0], target: [-4.6, 0.0, -8.5], focus: 5 },
};

const FAKE_WISH = {
  id: 9_000_001,
  nickname: '盲審鏡頭',
  message: '願這片楓林的光，照進每個人的秋天',
  created_at: '2026-11-23T08:00:00.000Z',
  createdAt: '2026-11-23T08:00:00.000Z',
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const problems = [];
async function open(query, context = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-TW', ...context });
  const page = await ctx.newPage();
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`console.${message.type()}: ${message.text().slice(0, 300)}`);
  });
  await page.goto(`${base}/${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__wishWall?.leaves.size > 0);
  await sleep(6000);
  return { ctx, page };
}

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
          if (now - start < 3000) requestAnimationFrame(tick);
          else {
            times.sort((a, b) => a - b);
            const mean = times.reduce((sum, t) => sum + t, 0) / times.length;
            resolve(`${mean.toFixed(1)} ms（p95 ${times[Math.floor(times.length * 0.95)].toFixed(1)}）`);
          }
        };
        requestAnimationFrame(tick);
      }),
  );

{
  const { ctx, page } = await open(`?quality=${quality}`);
  console.log(`01 home  ${await frameStats(page)}`);
  await page.screenshot({ path: file('01-home') });

  // 許願葉飄落後（前端直接加一片，與送出成功後的呼叫相同）
  await page.evaluate((wish) => window.__wishWall.leaves.add(wish, { arrive: 'fall', featured: true }), FAKE_WISH);
  await sleep(8500);
  await page.screenshot({ path: file('02-wish-settled') });

  const position = await page.evaluate((id) => window.__wishWall.leaves.screenPosition(id), FAKE_WISH.id);
  await page.mouse.click(position.x, position.y);
  await sleep(2500);
  const opened = await page.evaluate(() => document.getElementById('wish-card-dialog').open);
  if (!opened) problems.push('卡片沒有打開');
  await page.screenshot({ path: file('03-card') });
  await page.keyboard.press('Escape');
  await sleep(500);

  for (const [name, pose, index] of [['up', POSES.up, '04'], ['ground', POSES.ground, '05']]) {
    await page.evaluate((p) => window.__visual.setPose(p), pose);
    await sleep(2500);
    console.log(`${index} ${name}  ${await frameStats(page)}`);
    await page.screenshot({ path: file(`${index}-${name}`) });
  }
  await ctx.close();
}
{
  const { ctx, page } = await open('', {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  console.log(`06 mobile  tier=${await page.evaluate(() => window.__visual.tier)}  ${await frameStats(page)}`);
  await page.screenshot({ path: file('06-mobile') });
  await ctx.close();
}
await browser.close();
console.log(problems.length ? `問題：\n${problems.join('\n')}` : '沒有 console 錯誤');
