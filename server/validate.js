// 留言驗證：長度、空白、網址與髒話過濾。前後端共用同一組上限。

export const NICKNAME_MAX = 20;
export const MESSAGE_MAX = 80;

// 基本髒話清單（比對前會先做 NFKC 正規化、轉小寫並移除空白）
const BLOCKED_WORDS = [
  '幹你', '幹妳', '操你', '操妳', '肏', '靠北', '靠腰', '機掰', '雞掰', '機歪',
  '三小', '婊子', '賤人', '智障', '白癡', '白痴', '王八蛋', '去死', '屌你', '傻逼', '傻屄',
  '垃圾人', 'fuck', 'shit', 'bitch', 'asshole', 'pussy', 'cunt', 'nigger', 'faggot',
];

// 含 http、www 或常見網址形式一律拒絕，避免廣告
const URL_PATTERN = /https?|www\.|:\/\/|[a-z0-9-]+\.(?:com|net|org|io|tw|cn|xyz|top|cc|ly|me|info|shop|app|dev)\b/i;

// 控制字元、零寬空白與雙向控制字元（保留 ZWJ/ZWNJ，emoji 組合會用到）
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/** 以 code point 計算長度，emoji 與中文字都算 1 字 */
export const charLength = (text) => Array.from(text).length;

/** 去除控制字元與零寬字元、合併連續空白、去除前後空白 */
function clean(value) {
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

function findProblem(text) {
  const normalized = text.normalize('NFKC').toLowerCase();
  if (URL_PATTERN.test(normalized)) return '留言不能包含網址';
  const compact = normalized.replace(/[\s\u200c\u200d]+/g, '');
  if (BLOCKED_WORDS.some((word) => compact.includes(word))) return '留言含有不適當的字詞';
  return null;
}

/**
 * 驗證並整理留言。
 * 回傳 { ok: true, value: { nickname, message } } 或 { ok: false, error }。
 */
export function validateWish(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: '資料格式不正確' };
  }
  const { nickname = '', message } = body;
  if (typeof message !== 'string') return { ok: false, error: '請寫下你的願望' };
  if (nickname !== null && typeof nickname !== 'string') {
    return { ok: false, error: '暱稱格式不正確' };
  }

  const cleanMessage = clean(message);
  const cleanNickname = clean(nickname ?? '');

  if (cleanMessage.length === 0) return { ok: false, error: '請寫下你的願望' };
  if (charLength(cleanMessage) > MESSAGE_MAX) {
    return { ok: false, error: `願望最多 ${MESSAGE_MAX} 字` };
  }
  if (charLength(cleanNickname) > NICKNAME_MAX) {
    return { ok: false, error: `暱稱最多 ${NICKNAME_MAX} 字` };
  }

  const problem = findProblem(cleanMessage) ?? findProblem(cleanNickname);
  if (problem) return { ok: false, error: problem };

  return { ok: true, value: { nickname: cleanNickname, message: cleanMessage } };
}
