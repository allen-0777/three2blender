// node --test：驗證規則、速率限制，以及用 JSON 檔 fallback 跑完整 API
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../server/app.js';
import { createRateLimiter } from '../server/rateLimit.js';
import { createFileStore } from '../server/store.js';
import { validateWish } from '../server/validate.js';

describe('validateWish', () => {
  test('去除前後空白並接受合法留言', () => {
    const result = validateWish({ nickname: '  小楓 ', message: '  希望媽媽的身體健康\n ' });
    assert.deepEqual(result, { ok: true, value: { nickname: '小楓', message: '希望媽媽的身體健康' } });
  });

  test('暱稱選填', () => {
    assert.equal(validateWish({ message: '平安' }).value.nickname, '');
    assert.equal(validateWish({ nickname: null, message: '平安' }).value.nickname, '');
  });

  test('拒絕空白內容', () => {
    for (const message of ['', '   ', '\n\t', '​​', undefined, 123, null]) {
      assert.equal(validateWish({ message }).ok, false, JSON.stringify(message));
    }
  });

  test('長度以字為單位：80 字可以、81 字拒絕', () => {
    assert.equal(validateWish({ message: '楓'.repeat(80) }).ok, true);
    assert.equal(validateWish({ message: '🍁'.repeat(80) }).ok, true);
    assert.equal(validateWish({ message: '楓'.repeat(81) }).ok, false);
    assert.equal(validateWish({ nickname: '楓'.repeat(20), message: '好' }).ok, true);
    assert.equal(validateWish({ nickname: '楓'.repeat(21), message: '好' }).ok, false);
  });

  test('拒絕網址', () => {
    for (const message of [
      '來看 http://spam.example',
      'HTTPS://x.y',
      'www.example.com 很讚',
      'ｗｗｗ．spam．com',
      '加我 line spam.xyz',
    ]) {
      assert.equal(validateWish({ message }).ok, false, message);
    }
    assert.equal(validateWish({ nickname: 'www.ad.com', message: '好' }).ok, false);
  });

  test('拒絕髒話（含夾空白與大小寫）', () => {
    for (const message of ['F U C K', '你這個白 癡', 'Shit happens']) {
      assert.equal(validateWish({ message }).ok, false, message);
    }
  });

  test('拒絕非物件的內容', () => {
    for (const body of [null, undefined, 'x', [], 5]) assert.equal(validateWish(body).ok, false);
  });
});

describe('createRateLimiter', () => {
  test('視窗內超過上限就要等，視窗過了恢復', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      assert.equal(limiter.retryAfterSeconds('a', t0 + i), 0);
      limiter.record('a', t0 + i);
    }
    assert.equal(limiter.retryAfterSeconds('a', t0 + 10_000), 50);
    assert.equal(limiter.retryAfterSeconds('b', t0 + 10_000), 0);
    assert.equal(limiter.retryAfterSeconds('a', t0 + 60_001), 0);
  });
});

describe('API（JSON 檔 fallback）', () => {
  let directory;
  let server;
  let base;
  let file;

  const post = (body, raw = false) =>
    fetch(`${base}/api/wishes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw ? body : JSON.stringify(body),
    });

  before(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'wish-wall-'));
    file = path.join(directory, 'nested', 'wishes.json');
    const store = await createFileStore({ file });
    const app = createApp({ store, distDir: path.join(directory, 'dist') });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  test('healthz 回 200', async () => {
    const response = await fetch(`${base}/healthz`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'ok');
  });

  test('一開始是空的', async () => {
    assert.deepEqual(await (await fetch(`${base}/api/wishes`)).json(), { wishes: [], count: 0 });
    assert.deepEqual(await (await fetch(`${base}/api/wishes/count`)).json(), { count: 0 });
  });

  test('不合法的內容回 400，且不佔用速率額度', async () => {
    for (const body of [{ message: '   ' }, { message: 'x'.repeat(81) }, { message: 'http://a.b' }, {}]) {
      assert.equal((await post(body)).status, 400);
    }
    assert.equal((await post('{oops', true)).status, 400);
    assert.equal((await post(JSON.stringify({ message: 'x'.repeat(10_000) }), true)).status, 413);
    assert.equal((await (await fetch(`${base}/api/wishes/count`)).json()).count, 0);
  });

  test('POST 後 GET 拿得到、count 正確、內容原樣保存（不做 HTML 轉義）', async () => {
    const first = await post({ nickname: ' 阿楓 ', message: ' <img src=x onerror=alert(1)> ' });
    assert.equal(first.status, 201);
    const created = await first.json();
    assert.equal(created.count, 1);
    assert.equal(created.wish.nickname, '阿楓');
    assert.equal(created.wish.message, '<img src=x onerror=alert(1)>');
    assert.ok(!Number.isNaN(Date.parse(created.wish.created_at)));

    assert.equal((await post({ message: '第二片' })).status, 201);

    const list = await (await fetch(`${base}/api/wishes?limit=100`)).json();
    assert.equal(list.count, 2);
    assert.deepEqual(list.wishes.map((wish) => wish.message), ['第二片', '<img src=x onerror=alert(1)>']);

    const limited = await (await fetch(`${base}/api/wishes?limit=1`)).json();
    assert.equal(limited.wishes.length, 1);
    assert.equal(limited.wishes[0].message, '第二片');

    const newer = await (await fetch(`${base}/api/wishes?after=${created.wish.id}`)).json();
    assert.deepEqual(newer.wishes.map((wish) => wish.message), ['第二片']);

    const junk = await fetch(`${base}/api/wishes?limit=abc&after=-5`);
    assert.equal(junk.status, 200);
    assert.equal((await junk.json()).wishes.length, 2);

    assert.equal(JSON.parse(await readFile(file, 'utf8')).length, 2);
  });

  test('每 IP 每分鐘 3 則：第 4 則回 429 並帶 Retry-After', async () => {
    assert.equal((await post({ message: '第三片' })).status, 201);
    const blocked = await post({ message: '第四片' });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.equal((await (await fetch(`${base}/api/wishes/count`)).json()).count, 3);
  });

  test('未知的 API 路徑回 404 JSON', async () => {
    const response = await fetch(`${base}/api/nope`);
    assert.equal(response.status, 404);
    assert.ok((await response.json()).error);
  });
});
