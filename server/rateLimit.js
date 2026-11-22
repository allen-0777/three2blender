// 簡單的每 IP 滑動視窗速率限制（記憶體內，單一服務實例適用）

export function createRateLimiter({ limit = 3, windowMs = 60_000 } = {}) {
  /** @type {Map<string, number[]>} key -> 視窗內各次成功的時間戳 */
  const hits = new Map();

  const recent = (key, now) => {
    const list = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
    if (list.length > 0) hits.set(key, list);
    else hits.delete(key);
    return list;
  };

  // 定期清掉過期的 key，避免 Map 無限成長
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const key of hits.keys()) recent(key, now);
  }, windowMs);
  sweep.unref();

  return {
    /** 回傳 0 表示可以送出；否則回傳還要等幾秒 */
    retryAfterSeconds(key, now = Date.now()) {
      const list = recent(key, now);
      if (list.length < limit) return 0;
      return Math.max(1, Math.ceil((list[0] + windowMs - now) / 1000));
    },
    record(key, now = Date.now()) {
      hits.set(key, [...recent(key, now), now]);
    },
  };
}
