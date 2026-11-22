// 留言儲存層：有 DATABASE_URL 用 PostgreSQL，否則 fallback 到本機 JSON 檔。
// 兩種實作介面相同：list({ limit, after }) / add({ nickname, message }) / count() / close()

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS wishes (
    id BIGSERIAL PRIMARY KEY,
    nickname VARCHAR(20) NOT NULL DEFAULT '',
    message VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

const toWish = (row) => ({
  id: Number(row.id),
  nickname: row.nickname,
  message: row.message,
  created_at: new Date(row.created_at).toISOString(),
});

/** PostgreSQL 儲存。pool 可由外部注入（測試用）。 */
export async function createPostgresStore({ connectionString, pool }) {
  if (!pool) {
    const { default: pg } = await import('pg');
    // TLS 行為依連線字串的 sslmode 決定，不在程式裡關閉憑證驗證
    pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 10_000 });
    pool.on('error', (error) => console.error('[db] 閒置連線發生錯誤：', error.message));
  }
  await pool.query(CREATE_TABLE);

  return {
    kind: 'postgres',
    async list({ limit, after }) {
      const { rows } = await pool.query(
        'SELECT id, nickname, message, created_at FROM wishes WHERE id > $1 ORDER BY id DESC LIMIT $2',
        [after, limit],
      );
      return rows.map(toWish);
    },
    async add({ nickname, message }) {
      const { rows } = await pool.query(
        'INSERT INTO wishes (nickname, message) VALUES ($1, $2) RETURNING id, nickname, message, created_at',
        [nickname, message],
      );
      return toWish(rows[0]);
    },
    async count() {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM wishes');
      return rows[0].count;
    },
    close: () => pool.end(),
  };
}

/** 本機 JSON 檔儲存（僅供沒有 Postgres 的本機開發使用） */
export async function createFileStore({ file }) {
  let wishes = [];
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (Array.isArray(parsed)) wishes = parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[store] 無法讀取 ${file}（${error.message}），從空白開始`);
    }
  }
  let nextId = wishes.reduce((max, wish) => Math.max(max, wish.id), 0) + 1;

  // 寫入依序排隊，先寫暫存檔再 rename，避免寫到一半的檔案
  let queue = Promise.resolve();
  const persist = () => {
    queue = queue.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.tmp`;
      await writeFile(temp, JSON.stringify(wishes));
      await rename(temp, file);
    });
    return queue;
  };

  return {
    kind: 'file',
    async list({ limit, after }) {
      return wishes.filter((wish) => wish.id > after).slice(-limit).reverse();
    },
    async add({ nickname, message }) {
      const wish = { id: nextId++, nickname, message, created_at: new Date().toISOString() };
      wishes.push(wish);
      try {
        await persist();
      } catch (error) {
        // 寫檔失敗就不要讓記憶體與檔案不一致
        wishes = wishes.filter((item) => item !== wish);
        queue = Promise.resolve();
        throw error;
      }
      return wish;
    },
    async count() {
      return wishes.length;
    },
    close: () => queue,
  };
}

/** 依環境變數挑選儲存方式 */
export async function createStore({ databaseUrl, fallbackFile }) {
  if (databaseUrl) {
    const store = await createPostgresStore({ connectionString: databaseUrl });
    console.log('[store] 使用 PostgreSQL（DATABASE_URL），已確認 wishes 資料表存在');
    return store;
  }
  const store = await createFileStore({ file: fallbackFile });
  console.warn(
    `[store] 未設定 DATABASE_URL —— 使用 FALLBACK 本機 JSON 檔儲存：${fallbackFile}（僅供本機測試，正式環境請設定 DATABASE_URL）`,
  );
  return store;
}
