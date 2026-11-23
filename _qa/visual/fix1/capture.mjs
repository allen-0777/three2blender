// 修正前後對照用的截圖（不送留言、不受率限影響）：
//   node _qa/visual/fix1/capture.mjs <playwright-core 的路徑> <base URL> <前綴，例如 before 或 after>
// 需要服務已在跑。截圖寫在本目錄：<前綴>-desktop-high.png、<前綴>-desktop-topleft.png（左上樹冠 2× 裁切）、
// <前綴>-desktop-wish-closeup.png（許願葉 2× 裁切）、<前綴>-desktop-low.png、<前綴>-mobile.png。
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [corePath, base = 'http://localhost:3100', prefix = 'after'] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(path.resolve(corePath));
const out = path.dirname(fileURLToPath(import.meta.url));
const file = (name) => path.join(out, `${prefix}-${name}.png`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function open(query, context = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-TW', ...context });
  const page = await ctx.newPage();
  page.on('pageerror', (error) => console.log(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') console.log(`console.${message.type()}: ${message.text().slice(0, 300)}`);
  });
  await page.goto(`${base}/${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__wishWall?.leaves.size > 0);
  await sleep(6000);
  return { ctx, page };
}

{
  const { ctx, page } = await open('?quality=high');
  await page.screenshot({ path: file('desktop-high') });
  await page.screenshot({ path: file('desktop-topleft'), clip: { x: 0, y: 0, width: 620, height: 470 } });
  await page.screenshot({ path: file('desktop-wish-closeup'), clip: { x: 760, y: 330, width: 620, height: 470 } });
  await ctx.close();
}
{
  const { ctx, page } = await open('?quality=low');
  await page.screenshot({ path: file('desktop-low') });
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
  await page.screenshot({ path: file('mobile') });
  await ctx.close();
}
await browser.close();
console.log(`已寫入 ${out}/${prefix}-*.png`);
