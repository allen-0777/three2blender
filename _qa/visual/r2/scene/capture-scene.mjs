// 場景豐富（雙場景）的固定鏡頭截圖：不送留言。
//   node _qa/visual/r2/scene/capture-scene.mjs <playwright-core 的路徑> <base URL> <輸出目錄>
// 截圖（1440×900 @2×，high；手機 390×844 @3×，自動選檔）：
//   s1-01-home                          場景一首頁（回歸）
//   s2-<時段>-01-home                   場景二首頁（午後／黃昏／夜晚）
//   s2-afternoon-02-wish-settled        許願葉飄落停好後
//   s2-afternoon-03-card                點許願葉打開卡片
//   s2-<時段>-04-creek                  小溪與木橋近景（倒影、漂葉、燈籠）
//   s2-afternoon-05-giant               神木根部仰望
//   s2-<時段>-06-mobile                 手機直式
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const [corePath, base = 'http://localhost:3100', outDir = '.'] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(path.resolve(corePath));
mkdirSync(outDir, { recursive: true });
const file = (name) => path.join(outDir, `${name}.png`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const POSES = {
  creek: { position: [1.7, 1.55, 7.2], target: [-1.4, 0.0, -4.0], focus: 9.5 },
  giant: { position: [3.2, 1.3, -17.5], target: [0.4, 7.5, -31], focus: 14 },
};
const FAKE_WISH = {
  id: 9_000_001,
  nickname: '盲審鏡頭',
  message: '願這片楓林的光，照進每個人的秋天',
  created_at: '2026-11-23T08:00:00.000Z',
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
  await page.waitForFunction(() => window.__wishWall?.leaves.size > 0 && window.__scenes && !window.__scenes.busy, null, { timeout: 90000 });
  await sleep(6000);
  return { ctx, page };
}

{
  const { ctx, page } = await open('?quality=high&scene=1');
  await page.screenshot({ path: file('s1-01-home') });
  await ctx.close();
}

for (const time of ['afternoon', 'dusk', 'night']) {
  const { ctx, page } = await open(`?quality=high&scene=2&time=${time}`);
  await page.screenshot({ path: file(`s2-${time}-01-home`) });
  if (time === 'afternoon') {
    await page.evaluate((wish) => window.__wishWall.leaves.add(wish, { arrive: 'fall', featured: true }), FAKE_WISH);
    await sleep(8500);
    await page.screenshot({ path: file(`s2-${time}-02-wish-settled`) });
    const p = await page.evaluate((id) => window.__wishWall.leaves.screenPosition(id), FAKE_WISH.id);
    await page.mouse.click(p.x, p.y);
    await sleep(2500);
    if (!(await page.evaluate(() => document.getElementById('wish-card-dialog').open))) problems.push('場景二卡片沒有打開');
    await page.screenshot({ path: file(`s2-${time}-03-card`) });
    await page.keyboard.press('Escape');
    await sleep(500);
  }
  await page.evaluate((pose) => window.__visual.setPose(pose), POSES.creek);
  await sleep(2500);
  await page.screenshot({ path: file(`s2-${time}-04-creek`) });
  if (time === 'afternoon') {
    await page.evaluate((pose) => window.__visual.setPose(pose), POSES.giant);
    await sleep(2500);
    await page.screenshot({ path: file(`s2-${time}-05-giant`) });
  }
  await ctx.close();
}

for (const time of ['afternoon', 'night']) {
  const { ctx, page } = await open(`?scene=2&time=${time}`, {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  console.log(`mobile ${time} tier=${await page.evaluate(() => window.__visual.tier)}`);
  await page.screenshot({ path: file(`s2-${time}-06-mobile`) });
  await ctx.close();
}
await browser.close();
console.log(problems.length ? `問題：\n${[...new Set(problems)].join('\n')}` : '沒有 console 錯誤');
