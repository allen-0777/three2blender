// 場景與時段切換的 UI：右上角一組低調的小按鈕（🍁 場景一／🌳 場景二），
// 場景二時下面多一排「午後／黃昏／夜晚」。切換時整個畫面柔和地淡出再淡入。
// 選擇的優先順序：網址參數 ?scene=1|2、?time= → 使用者上次的選擇（localStorage）→ 預設（場景一、午後）。
// 只有使用者自己點的才會記住。

const STORAGE = { scene: 'maple-season:scene', time: 'maple-season:time' };
const TIMES = ['afternoon', 'dusk', 'night'];
const FADE_MS = 650;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frames = (n) =>
  new Promise((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // 隱私模式等情況
  }
}
function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 寫不進去就算了，下次用預設值
  }
}

/** 決定開場的場景與時段 */
export function initialChoice(params) {
  const fromUrl = params.get('scene');
  const scene = fromUrl === '2' || fromUrl === '1' ? Number(fromUrl) : readStorage(STORAGE.scene) === '2' ? 2 : 1;
  const urlTime = params.get('time');
  const storedTime = readStorage(STORAGE.time);
  const time = TIMES.includes(urlTime) ? urlTime : TIMES.includes(storedTime) ? storedTime : 'afternoon';
  return { scene, time };
}

/**
 * root：.scene-switch；fade：.scene-fade。
 * load(scene) → Promise：第一次切到場景二時載入；activate(scene, time)：實際換場景；setTime(time)：換時段。
 */
export function createSceneSwitch({ root, fade, initial, load, activate, setTime, reducedMotion = false }) {
  const sceneButtons = [...root.querySelectorAll('[data-scene]')];
  const timeGroup = root.querySelector('.scene-switch__time');
  const timeButtons = [...root.querySelectorAll('[data-time]')];
  let scene = 1;
  let time = initial.time;
  let busy = null;
  const fadeMs = reducedMotion ? 200 : FADE_MS;
  fade.style.setProperty('--fade-ms', `${fadeMs}ms`);

  function syncButtons() {
    for (const b of sceneButtons) b.setAttribute('aria-pressed', String(Number(b.dataset.scene) === scene));
    for (const b of timeButtons) b.setAttribute('aria-pressed', String(b.dataset.time === time));
    timeGroup.hidden = scene !== 2;
    document.documentElement.dataset.scene = String(scene);
    document.documentElement.dataset.time = scene === 2 ? time : '';
  }

  /** 淡出 → 做事 → 等幾幀（shader 編譯、陰影、倒影）→ 淡入 */
  async function transition(work, { label = '' } = {}) {
    fade.dataset.label = label;
    fade.classList.add('is-on');
    await wait(fadeMs);
    try {
      await work();
    } finally {
      await frames(3);
      fade.classList.remove('is-on');
    }
  }

  /** 一次只做一個切換；連點時依序排隊 */
  function run(task) {
    const next = (busy ?? Promise.resolve()).then(() => task());
    const tracked = next
      .catch((error) => console.error('場景切換失敗', error))
      .finally(() => {
        if (busy === tracked) busy = null;
      });
    busy = tracked;
    return next;
  }

  async function switchTo(next, { remember = true } = {}) {
    return run(async () => {
      if (next === scene) return;
      await transition(
        async () => {
          await load(next);
          scene = next;
          activate(scene, time);
          syncButtons();
        },
        { label: next === 2 ? '前往神木小溪…' : '' },
      );
      if (remember) writeStorage(STORAGE.scene, String(next));
    });
  }

  async function changeTime(next, { remember = true } = {}) {
    if (!TIMES.includes(next)) return undefined;
    return run(async () => {
      if (next === time || scene !== 2) {
        time = next;
        syncButtons();
        return;
      }
      await transition(async () => {
        time = next;
        setTime(time);
        syncButtons();
      });
      if (remember) writeStorage(STORAGE.time, next);
    });
  }

  for (const b of sceneButtons) b.addEventListener('click', () => switchTo(Number(b.dataset.scene)));
  for (const b of timeButtons) b.addEventListener('click', () => changeTime(b.dataset.time));

  syncButtons();
  // 開場就是場景二：畫面先蓋著，載入好再淡入
  const ready =
    initial.scene === 2
      ? (async () => {
          fade.classList.add('is-on', 'is-instant');
          fade.dataset.label = '前往神木小溪…';
          await load(2);
          scene = 2;
          activate(2, time);
          syncButtons();
          await frames(3);
          fade.classList.remove('is-instant');
          fade.classList.remove('is-on');
        })()
      : Promise.resolve();

  return {
    ready,
    switchTo,
    setTime: changeTime,
    get scene() {
      return scene;
    },
    get time() {
      return time;
    },
    get busy() {
      return busy !== null;
    },
  };
}
