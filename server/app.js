// Express 應用：API + dist/ 靜態檔。與啟動流程分開，方便測試。

import express from 'express';
import { createRateLimiter } from './rateLimit.js';
import { validateWish } from './validate.js';

const MAX_LIMIT = 100;

/** 解析非負整數查詢參數；不合法時回傳 fallback */
function parseInteger(value, fallback) {
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) return fallback;
  return Number(value);
}

export function createApp({ store, distDir, rateLimit = { limit: 3, windowMs: 60_000 } }) {
  const app = express();
  app.disable('x-powered-by');
  // 部署在平台的反向代理後面：信任一層代理，req.ip 才會是真正的用戶端 IP。
  // 注意：若服務直接對外（前面沒有代理），用戶端可以偽造 X-Forwarded-For 繞過每 IP 限制。
  app.set('trust proxy', 1);

  const limiter = createRateLimiter(rateLimit);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/healthz', (req, res) => {
    res.json({ status: 'ok', store: store.kind });
  });

  const api = express.Router();
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '4kb' }));

  // GET /api/wishes?limit=100&after=<id>：最新的在前；after 用於輪詢只拿新留言
  api.get('/wishes', async (req, res) => {
    const limit = Math.min(Math.max(parseInteger(req.query.limit, MAX_LIMIT), 1), MAX_LIMIT);
    const after = parseInteger(req.query.after, 0);
    const [wishes, count] = await Promise.all([store.list({ limit, after }), store.count()]);
    res.json({ wishes, count });
  });

  api.get('/wishes/count', async (req, res) => {
    res.json({ count: await store.count() });
  });

  api.post('/wishes', async (req, res) => {
    // 先同步佔用額度再做任何 await，避免並發請求同時通過檢查
    const slot = limiter.tryConsume(req.ip ?? 'unknown');
    if (!slot.ok) {
      res.setHeader('Retry-After', String(slot.retryAfter));
      res.status(429).json({ error: `留言太頻繁了，請 ${slot.retryAfter} 秒後再試` });
      return;
    }

    const result = validateWish(req.body);
    if (!result.ok) {
      slot.release();
      res.status(400).json({ error: result.error });
      return;
    }

    let wish;
    try {
      wish = await store.add(result.value);
    } catch (error) {
      slot.release();
      throw error;
    }
    res.status(201).json({ wish, count: await store.count() });
  });

  api.use((req, res) => {
    res.status(404).json({ error: '找不到這個 API' });
  });

  app.use('/api', api);

  // 帶 hash 的建置產物可以長期快取；index.html 每次都重新驗證
  app.use(
    '/assets',
    express.static(`${distDir}/assets`, { immutable: true, maxAge: '1y', fallthrough: false }),
  );
  app.use(express.static(distDir, { maxAge: 0 }));

  app.use((req, res) => {
    res.status(404).type('text/plain; charset=utf-8').send('Not Found');
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const isApi = req.originalUrl.startsWith('/api');
    if (error.type === 'entity.too.large') {
      res.status(413).json({ error: '內容太長了' });
    } else if (error.type === 'entity.parse.failed' || error.type === 'charset.unsupported') {
      res.status(400).json({ error: '資料格式不正確' });
    } else if (error.status >= 400 && error.status < 500) {
      // 例如靜態檔不存在（404）或路徑穿越被擋下（403）
      const status = error.status === 403 ? 403 : 404;
      if (isApi) res.status(status).json({ error: '找不到這個 API' });
      else res.status(status).type('text/plain; charset=utf-8').send(status === 403 ? 'Forbidden' : 'Not Found');
    } else {
      console.error(`[error] ${req.method} ${req.originalUrl}:`, error.message);
      if (isApi) res.status(500).json({ error: '伺服器忙碌中，請稍後再試' });
      else res.status(500).type('text/plain; charset=utf-8').send('Internal Server Error');
    }
  });

  return app;
}
