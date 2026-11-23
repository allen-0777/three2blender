// 開發用快照：node shot.mjs <playwright-core> <url> <out.png> [等待毫秒] [JS 運算式（在頁面裡執行）]
// 不送留言。印出 console 錯誤／警告與目前狀態。
import { createRequire } from 'node:module';
import path from 'node:path';

const [corePath, url, out, wait = '6000', script = ''] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(path.resolve(corePath));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
const mobile = process.env.SHOT_MOBILE === '1';
const ctx = await browser.newContext(
  mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'zh-TW' }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.SHOT_DPR ?? 1), locale: 'zh-TW' },
);
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`console.${m.type()}: ${m.text().slice(0, 400)}`);
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__wishWall?.leaves.size > 0, null, { timeout: 30000 }).catch(() => problems.push('no wish leaves'));
if (script) await page.evaluate(script);
await new Promise((r) => setTimeout(r, Number(wait)));
await page.screenshot({ path: out });
const state = await page.evaluate(() => ({ ...(window.__visual?.info?.() ?? {}), frameMs: window.__visual?.frameMs, scene: window.__scenes?.current, time: window.__scenes?.time }));
console.log(JSON.stringify(state));
console.log(problems.length ? problems.join('\n') : 'no console problems');
await browser.close();
