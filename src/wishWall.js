import * as THREE from 'three';

// 許願牆的 UI 與 API 串接：表單、留言卡片、計數、輪詢、點擊楓葉。
// 使用者輸入的內容一律用 textContent 放進畫面，不使用 innerHTML。

// 與 server/validate.js 的上限一致（伺服器端才是最終把關）
const NICKNAME_MAX = 20;
const MESSAGE_MAX = 80;
const POLL_INTERVAL = 15_000;
const PAGE_SIZE = 100;
const ANONYMOUS = '匿名旅人';

const charLength = (text) => Array.from(text).length;
const timeFormat = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, ...options });
  } catch {
    throw new Error('連不上許願牆，請檢查網路後再試');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? '伺服器忙碌中，請稍後再試');
  if (data === null) throw new Error('伺服器回應格式不正確');
  return data;
}

export function initWishWall({ canvas, camera, wishLeaves }) {
  const $ = (id) => document.getElementById(id);
  const openButton = $('wish-open');
  const countLabel = $('wish-count');
  const toast = $('wish-toast');
  const formDialog = $('wish-form-dialog');
  const form = $('wish-form');
  const nicknameInput = $('wish-nickname');
  const messageInput = $('wish-message');
  const nicknameCounter = $('wish-nickname-counter');
  const messageCounter = $('wish-message-counter');
  const formError = $('wish-error');
  const submitButton = $('wish-submit');
  const cardDialog = $('wish-card-dialog');
  const cardNickname = $('wish-card-nickname');
  const cardMessage = $('wish-card-message');
  const cardTime = $('wish-card-time');

  let lastId = 0;
  let loaded = false;
  let submitting = false;

  // ---- 計數與提示 ----
  function setCount(count) {
    if (Number.isFinite(count)) countLabel.textContent = `已有 ${count} 片楓葉`;
  }

  let toastTimer;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 4200);
  }

  // ---- 讀取與輪詢 ----
  function absorb(wishes, options) {
    // API 回傳最新的在前；由舊到新加入，讓飄落順序自然
    [...wishes].reverse().forEach((wish, i) => {
      lastId = Math.max(lastId, wish.id);
      wishLeaves.add(wish, typeof options === 'function' ? options(i) : options);
    });
  }

  async function refresh() {
    const query = loaded ? `limit=${PAGE_SIZE}&after=${lastId}` : `limit=${PAGE_SIZE}`;
    const data = await request(`/api/wishes?${query}`);
    if (loaded) {
      absorb(data.wishes, (i) => ({ arrive: 'fall', delay: i * 0.6 }));
    } else {
      absorb(data.wishes, (i) => ({ arrive: 'appear', delay: 0.4 + i * 0.03 }));
      loaded = true;
    }
    setCount(data.count);
  }

  let pollTimer;
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      // 分頁在背景時不打 API，切回來時再補
      if (!document.hidden) await refresh().catch(() => {});
      schedulePoll();
    }, POLL_INTERVAL);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refresh().catch(() => {});
    schedulePoll();
  });

  refresh()
    .catch(() => {
      countLabel.textContent = '許願牆暫時連不上';
    })
    .finally(schedulePoll);

  // ---- 表單 ----
  function updateCounter(input, counter, max) {
    const length = charLength(input.value.trim());
    counter.textContent = `${length}/${max}`;
    counter.classList.toggle('is-over', length > max);
    return length;
  }

  function validateForm() {
    const nicknameLength = updateCounter(nicknameInput, nicknameCounter, NICKNAME_MAX);
    const messageLength = updateCounter(messageInput, messageCounter, MESSAGE_MAX);
    if (messageLength === 0) return '請寫下你的願望';
    if (messageLength > MESSAGE_MAX) return `願望最多 ${MESSAGE_MAX} 字`;
    if (nicknameLength > NICKNAME_MAX) return `暱稱最多 ${NICKNAME_MAX} 字`;
    return null;
  }

  function setFormError(text) {
    formError.textContent = text ?? '';
    formError.hidden = !text;
  }

  nicknameInput.addEventListener('input', () => {
    validateForm();
    setFormError(null);
  });
  messageInput.addEventListener('input', () => {
    validateForm();
    setFormError(null);
  });

  openButton.addEventListener('click', () => {
    setFormError(null);
    validateForm();
    formDialog.showModal();
    messageInput.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const problem = validateForm();
    if (problem) {
      setFormError(problem);
      return;
    }

    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = '送出中…';
    setFormError(null);
    try {
      const data = await request('/api/wishes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ nickname: nicknameInput.value, message: messageInput.value }),
      });
      // 自己的楓葉放在鏡頭前方中央飄落；lastId 不往前跳，避免漏掉同時間別人的留言
      wishLeaves.add(data.wish, { arrive: 'fall', featured: true });
      // 給環境音（main.js）一個「留下楓葉」的提示音時機；不帶留言內容
      window.dispatchEvent(new CustomEvent('wish:planted'));
      setCount(data.count);
      messageInput.value = '';
      validateForm();
      formDialog.close();
      showToast('你的楓葉飄落了，點它可以再看一次願望');
    } catch (error) {
      setFormError(error.message);
    } finally {
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = '讓楓葉飄落';
    }
  });

  // ---- 留言卡片 ----
  function showCard(wish) {
    cardNickname.textContent = wish.nickname || ANONYMOUS;
    cardMessage.textContent = wish.message;
    const date = new Date(wish.created_at);
    const valid = !Number.isNaN(date.getTime());
    cardTime.textContent = valid ? timeFormat.format(date) : '';
    if (valid) cardTime.dateTime = date.toISOString();
    wishLeaves.setSelected(wish.id);
    if (!cardDialog.open) cardDialog.showModal();
  }
  cardDialog.addEventListener('close', () => wishLeaves.setSelected(null));

  // 對話框：點背景或「關閉」按鈕關閉（Esc 由 <dialog> 原生處理）
  for (const dialog of [formDialog, cardDialog]) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
    });
  }

  // ---- 點擊楓葉（raycaster）----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pickAt(clientX, clientY, minPixels) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    raycaster.setFromCamera(ndc, camera);
    return wishLeaves.pick(raycaster, { minPixels, viewportHeight: rect.height });
  }

  // 用 click 而不是 pointerup 開卡片：若在 pointerup 就開啟對話框，隨後的 click 會落在
  // 對話框背景上，把剛開的卡片立刻關掉。另外記下按下的位置，拖曳後放開不算點擊。
  let press = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary) return;
    press = { x: event.clientX, y: event.clientY, type: event.pointerType };
  });
  canvas.addEventListener('click', (event) => {
    const start = press;
    press = null;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
    const wish = pickAt(event.clientX, event.clientY, start?.type === 'mouse' ? 16 : 28);
    if (wish) showCard(wish);
  });

  // 滑鼠移到許願楓葉上時顯示手指游標
  let hoverFrame = 0;
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      canvas.style.cursor = pickAt(event.clientX, event.clientY, 16) ? 'pointer' : '';
    });
  });

  return { refresh, showCard };
}
