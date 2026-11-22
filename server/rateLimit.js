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
    /**
     * 檢查並佔用一個額度（同步完成，並發請求不會同時通過檢查）。
     * 回傳 { ok: true, release } 或 { ok: false, retryAfter: 秒數 }。
     * 留言最後沒有成立（驗證失敗、寫入失敗）時呼叫 release() 把額度還回去。
     */
    tryConsume(key, now = Date.now()) {
      const list = recent(key, now);
      if (list.length >= limit) {
        return { ok: false, retryAfter: Math.max(1, Math.ceil((list[0] + windowMs - now) / 1000)) };
      }
      hits.set(key, [...list, now]);
      let released = false;
      return {
        ok: true,
        release() {
          if (released) return;
          released = true;
          const current = hits.get(key);
          const index = current ? current.lastIndexOf(now) : -1;
          if (index === -1) return;
          current.splice(index, 1);
          if (current.length === 0) hits.delete(key);
        },
      };
    },
  };
}
