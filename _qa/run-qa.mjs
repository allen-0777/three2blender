// 瀏覽器驗收腳本（headless Chrome）。playwright-core 不是專案相依套件，路徑由參數傳入：
//   node _qa/run-qa.mjs <playwright-core 的路徑> [base URL]
// 需要服務已在跑（npm start），且該 IP 這一分鐘內還沒送過留言（腳本會送 2 則）。
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [corePath, base = 'http://localhost:3000'] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(path.resolve(corePath));
// 截圖預設寫在本目錄；設 QA_OUT 可改寫到別處（回歸時不覆蓋既有的驗收截圖）
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
    if (message.type() === 'error') problems.push(`${label} console.error: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`${label} HTTP ${response.status()} ${response.url()}`);
  });
}
const state = (page) =>
  page.evaluate(() => ({
    leaves: window.__wishWall.leaves.size,
    count: document.getElementById('wish-count').textContent,
  }));
const leafPosition = (page, id) => page.evaluate((wishId) => window.__wishWall.leaves.screenPosition(wishId), id);
const card = (page) =>
  page.evaluate(() => ({
    open: document.getElementById('wish-card-dialog').open,
    nickname: document.getElementById('wish-card-nickname').textContent,
    message: document.getElementById('wish-card-message').textContent,
    time: document.getElementById('wish-card-time').textContent,
    childElements: document.getElementById('wish-card-message').childElementCount,
  }));

const browser = await chromium.launch({ channel: 'chrome', headless: true });

// ---------- 桌機 ----------
const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW' });
const page = await desktop.newPage();
watch(page, 'desktop');
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.__wishWall?.leaves.size > 0);
await sleep(5000);
await page.waitForFunction(() => window.__visual.title.settled);
const initial = await state(page);
const serverCount = (await (await fetch(`${base}/api/wishes/count`)).json()).count;
check('桌機：場景載入，許願楓葉數 = min(留言數, 100)', initial.leaves === Math.min(serverCount, 100), JSON.stringify(initial));
check('桌機：計數顯示「已有 N 片楓葉」', initial.count === `已有 ${serverCount} 片楓葉`, initial.count);
const webgl = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log(`      WebGL renderer: ${webgl}`);
await shot(page, '01-desktop-scene.png');

await page.getByRole('button', { name: '留下你的楓葉' }).click();
await sleep(500);
check('桌機：點按鈕開啟表單', await page.evaluate(() => document.getElementById('wish-form-dialog').open));
await page.getByRole('button', { name: '讓楓葉飄落' }).click();
const emptyError = await page.locator('#wish-error').textContent();
check('桌機：空白送出被前端擋下並顯示錯誤', emptyError === '請寫下你的願望', emptyError);
await page.locator('#wish-message').fill('楓'.repeat(81));
check('桌機：超過 80 字計數器變紅', await page.evaluate(() => document.getElementById('wish-message-counter').classList.contains('is-over')));
await page.locator('#wish-message').fill('快來 http://spam.example');
await page.getByRole('button', { name: '讓楓葉飄落' }).click();
await page.waitForFunction(() => !document.getElementById('wish-error').hidden);
const urlError = await page.locator('#wish-error').textContent();
check('桌機：含網址的留言顯示伺服器的拒絕訊息', urlError === '留言不能包含網址', urlError);
await shot(page, '02-desktop-form-error.png');

await page.locator('#wish-nickname').fill('驗收小幫手');
await page.locator('#wish-message').fill('希望這片楓葉平安飄到每個人的螢幕上 🍁');
await sleep(200);
await shot(page, '03-desktop-form.png');
const [postResponse] = await Promise.all([
  page.waitForResponse((response) => response.url().endsWith('/api/wishes') && response.request().method() === 'POST'),
  page.getByRole('button', { name: '讓楓葉飄落' }).click(),
]);
const posted = await postResponse.json();
check('桌機：送出成功（201）', postResponse.status() === 201, `id=${posted.wish?.id}`);
await sleep(1800);
await shot(page, '04-desktop-leaf-falling.png');
await sleep(6500);
const afterSubmit = await state(page);
check('桌機：送出後多一片特別楓葉、計數 +1', afterSubmit.leaves === initial.leaves + 1 && afterSubmit.count === `已有 ${serverCount + 1} 片楓葉`, JSON.stringify(afterSubmit));
check('桌機：表單已關閉', !(await page.evaluate(() => document.getElementById('wish-form-dialog').open)));
await shot(page, '05-desktop-leaf-settled.png');

let position = await leafPosition(page, posted.wish.id);
await page.mouse.move(position.x, position.y);
await sleep(200);
check('桌機：滑到許願楓葉上游標變手指', (await page.evaluate(() => document.getElementById('scene').style.cursor)) === 'pointer');
position = await leafPosition(page, posted.wish.id);
await page.mouse.click(position.x, position.y);
await sleep(600);
let shown = await card(page);
check('桌機：點擊自己的楓葉跳出卡片（暱稱、內容、時間）', shown.open && shown.nickname === '驗收小幫手' && shown.message === posted.wish.message && shown.time.length > 0, JSON.stringify(shown));
await shot(page, '06-desktop-card.png');
await page.keyboard.press('Escape');
await sleep(300);
check('桌機：Esc 關閉卡片', !(await card(page)).open);

// XSS：資料裡有一則 <b>願世界和平</b>，應以純文字顯示
const xssWish = await page.evaluate(async () => {
  const data = await (await fetch('/api/wishes?limit=100')).json();
  return data.wishes.find((wish) => wish.message.includes('<b>')) ?? null;
});
if (xssWish) {
  await page.evaluate((wish) => window.__wishWall.showCard(wish), xssWish);
  await sleep(400);
  shown = await card(page);
  check('桌機：含 HTML 的留言以純文字顯示（textContent，未產生子元素）', shown.message === xssWish.message && shown.childElements === 0, JSON.stringify(shown));
  check('桌機：未填暱稱顯示「匿名旅人」', xssWish.nickname !== '' || shown.nickname === '匿名旅人', shown.nickname);
  await shot(page, '07-desktop-card-html-as-text.png');
  await page.getByRole('button', { name: '關閉' }).click();
}

// 點一片不在卡片範圍內的楓葉：卡片應開啟並維持開啟
const outside = await page.evaluate(async () => {
  const data = await (await fetch('/api/wishes?limit=100')).json();
  return data.wishes
    .map((wish) => ({ id: wish.id, message: wish.message, ...window.__wishWall.leaves.screenPosition(wish.id) }))
    .find((p) => (p.x < 380 || p.x > 900) && p.x > 40 && p.x < 1240 && p.y > 80 && p.y < 600);
});
const outsideNow = await leafPosition(page, outside.id);
await page.mouse.click(outsideNow.x, outsideNow.y);
await sleep(900);
shown = await card(page);
check('桌機：點卡片範圍外的楓葉，卡片開啟且維持開啟', shown.open && shown.message.length > 0, `click=(${Math.round(outsideNow.x)},${Math.round(outsideNow.y)}) ${shown.message}`);
await shot(page, '07b-desktop-card-side-leaf.png');
await page.mouse.click(20, 780);
await sleep(300);
check('桌機：點背景關閉卡片', !(await card(page)).open);

// 點空白處不應開卡片
await page.mouse.click(8, 8);
await sleep(300);
check('桌機：點沒有楓葉的地方不會開卡片', !(await card(page)).open);

// 輪詢：從頁面外送一則，不重新整理，等下一輪輪詢
const before = await state(page);
const external = await fetch(`${base}/api/wishes`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nickname: '另一位訪客', message: '從別的裝置送來的楓葉' }),
});
check('輪詢：外部送出一則（201）', external.status === 201);
const polled = await page
  .waitForFunction((size) => window.__wishWall.leaves.size > size, before.leaves, { timeout: 20000 })
  .then(() => true, () => false);
await sleep(2500);
const afterPoll = await state(page);
check('輪詢：約 15 秒內新楓葉自動出現、計數更新（未重新整理）', polled && afterPoll.count === `已有 ${serverCount + 2} 片楓葉`, JSON.stringify(afterPoll));
await shot(page, '08-desktop-poll-new-leaf.png');
const fps = await page.evaluate(
  () => new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    const tick = (now) => {
      frames++;
      if (now - start < 3000) requestAnimationFrame(tick);
      else resolve(Math.round((frames / (now - start)) * 1000));
    };
    requestAnimationFrame(tick);
  }),
);
console.log(`      桌機 headless 約 ${fps} fps（${afterPoll.leaves} 片許願楓葉）`);
await desktop.close();

// ---------- 手機（390x844、觸控）----------
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-TW',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});
const phone = await mobile.newPage();
watch(phone, 'mobile');
await phone.goto(base, { waitUntil: 'load' });
await phone.waitForFunction(() => window.__wishWall?.leaves.size > 0);
// Tap during the intro, before the hold timer expires.
await sleep(600);
const earlyTarget = await phone.evaluate(async () => {
  const { wishes } = await (await fetch('/api/wishes?limit=100')).json();
  return wishes.map((wish) => ({ ...wish, ...window.__wishWall.leaves.screenPosition(wish.id) }))
    .find((p) => p.x > 30 && p.x < innerWidth - 30 && p.y > 100 && p.y < 640);
});
check('手機：提早觸控前仍在開場', await phone.evaluate(() => window.__visual.title.state === 'visible'));
if (earlyTarget) {
  const p = await leafPosition(phone, earlyTarget.id);
  await phone.touchscreen.tap(p.x, p.y);
  await phone.waitForFunction(() => window.__visual.title.state === 'dismissed');
  check('手機：開場觸控開卡片並延後葉子移動', (await card(phone)).open &&
    await phone.evaluate(() => !window.__wishWall.leaves.moving && !window.__visual.title.settled));
  await phone.keyboard.press('Escape');
  await phone.waitForFunction(() => window.__visual.title.settled);
  check('手機：關卡片後標題不回來', await phone.evaluate(() => window.__visual.title.state === 'dismissed'));
} else check('手機：開場有可觸控的葉子', false);

await sleep(5000);
await phone.waitForFunction(() => window.__visual.title.settled);
const mobileState = await state(phone);
check('手機：場景載入、計數正確', mobileState.count === `已有 ${serverCount + 2} 片楓葉`, JSON.stringify(mobileState));
const onScreen = await phone.evaluate(async () => {
  const data = await (await fetch('/api/wishes?limit=100')).json();
  const inside = data.wishes.filter((wish) => {
    const p = window.__wishWall.leaves.screenPosition(wish.id);
    return p && p.x > 0 && p.x < innerWidth && p.y > 0 && p.y < innerHeight;
  }).length;
  return { inside, total: data.wishes.length, ids: data.wishes.map((wish) => wish.id) };
});
check('手機：所有許願楓葉都排在直式畫面範圍內', onScreen.inside === onScreen.total, `${onScreen.inside}/${onScreen.total}`);
check('手機：頁面沒有水平捲動', await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await shot(phone, '09-mobile-scene.png');

await phone.getByRole('button', { name: '留下你的楓葉' }).tap();
await sleep(500);
await phone.locator('#wish-nickname').fill('手機訪客');
await phone.locator('#wish-message').fill('用手機也能留下楓葉');
const formBox = await phone.locator('#wish-form').boundingBox();
check('手機：表單完整落在畫面內', formBox.x >= 0 && formBox.x + formBox.width <= 390 && formBox.y >= 0 && formBox.y + formBox.height <= 844, JSON.stringify(formBox));
const fontSize = await phone.evaluate(() => parseFloat(getComputedStyle(document.getElementById('wish-message')).fontSize));
check('手機：輸入框字級 ≥ 16px（iOS 不會自動放大）', fontSize >= 16, `${fontSize}px`);
await shot(phone, '10-mobile-form.png');
await phone.getByRole('button', { name: '取消' }).tap();
await sleep(300);

// 觸控點一片楓葉：挑最靠近畫面中段、沒被底部按鈕區遮住的
const target = await phone.evaluate((ids) => {
  const candidates = ids
    .map((id) => ({ id, ...window.__wishWall.leaves.screenPosition(id) }))
    .filter((p) => p.y > 520 && p.y < 640 && p.x > 30 && p.x < innerWidth - 30);
  return candidates[0];
}, onScreen.ids);
const targetNow = await leafPosition(phone, target.id);
await phone.touchscreen.tap(targetNow.x, targetNow.y);
await sleep(600);
const mobileCard = await card(phone);
check('手機：觸控點擊楓葉跳出卡片', mobileCard.open && mobileCard.message.length > 0, JSON.stringify(mobileCard));
await sleep(600);
check('手機：卡片開啟後維持開啟（點擊位置在卡片外，不會被隨後的 click 關掉）', (await card(phone)).open, `tap=(${Math.round(targetNow.x)},${Math.round(targetNow.y)})`);
await shot(phone, '11-mobile-card.png');
await phone.touchscreen.tap(380, 830);
await sleep(400);
check('手機：點卡片外的背景可關閉', !(await card(phone)).open);
await mobile.close();
await browser.close();

console.log('');
if (problems.length) console.log(`頁面錯誤／失敗請求：\n  ${problems.join('\n  ')}`);
else console.log('頁面沒有 console.error、未捕捉例外或 4xx/5xx 請求（預期中的 400 除外則會列在上面）');
const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} 項通過`);
process.exit(failed.length ? 1 : 0);
