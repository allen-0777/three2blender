// 楓葉許願牆服務入口：npm start
// 環境變數：PORT（預設 3000）、DATABASE_URL（未設定時 fallback 到本機 JSON 檔）

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createStore } from './store.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT) || 3000;

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.warn('[server] 找不到 dist/index.html，請先執行 npm run build（API 仍會啟動）');
}

let store;
try {
  store = await createStore({
    databaseUrl: process.env.DATABASE_URL,
    fallbackFile: path.join(rootDir, 'data', 'wishes.json'),
  });
} catch (error) {
  // 不輸出連線字串，只輸出錯誤訊息
  console.error('[server] 資料庫初始化失敗：', error.message);
  process.exit(1);
}

const app = createApp({ store, distDir });
const server = app.listen(port, () => {
  console.log(`[server] 楓葉許願牆已啟動：http://localhost:${port}（儲存：${store.kind}）`);
});

server.on('error', (error) => {
  console.error('[server] 無法啟動：', error.message);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`[server] 收到 ${signal}，關閉中…`);
  server.close(async () => {
    await store.close().catch(() => {});
    process.exit(0);
  });
  // 仍有連線卡住時強制結束
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
