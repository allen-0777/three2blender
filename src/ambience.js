// 環境音：全部用 Web Audio 即時合成，沒有音檔。
//   風聲：低通濾波的雜訊，音量與截止頻率隨機緩慢起伏（陣風）。
//   葉子沙沙：高頻帶通的雜訊，一陣一陣的短包絡，偶爾密集一點。
//   叮：留下楓葉時一聲輕柔的鐘聲（幾個不和諧泛音、指數衰減，再過一點回聲）。
// 預設靜音。瀏覽器的自動播放規則要求使用者手勢之後才能出聲，
// 所以 AudioContext 在第一次按下開關時才建立；關掉時淡出後 suspend，不佔 CPU。

const MASTER_LEVEL = 0.55;

function createNoiseBuffer(context, seconds = 4) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  // 粉紅雜訊（Paul Kellet 的近似），比白雜訊柔和，風聲更自然
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
  }
  return buffer;
}

function buildGraph(context) {
  const master = context.createGain();
  master.gain.value = 0;
  master.connect(context.destination);
  const noise = createNoiseBuffer(context);
  const loop = (rate = 1) => {
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    source.playbackRate.value = rate;
    source.start(0, Math.random() * noise.duration);
    return source;
  };

  // 風
  const windFilter = context.createBiquadFilter();
  windFilter.type = 'lowpass';
  windFilter.frequency.value = 380;
  windFilter.Q.value = 0.6;
  const windGain = context.createGain();
  windGain.gain.value = 0.5;
  loop(0.8).connect(windFilter).connect(windGain).connect(master);

  // 葉子沙沙
  const rustleFilter = context.createBiquadFilter();
  rustleFilter.type = 'bandpass';
  rustleFilter.frequency.value = 5200;
  rustleFilter.Q.value = 0.8;
  const rustleHigh = context.createBiquadFilter();
  rustleHigh.type = 'highpass';
  rustleHigh.frequency.value = 2200;
  const rustleGain = context.createGain();
  rustleGain.gain.value = 0;
  loop(1.3).connect(rustleHigh).connect(rustleFilter).connect(rustleGain).connect(master);

  // 叮的回聲（簡單的回授延遲，低通讓尾巴越來越暗）
  const echo = context.createDelay(1);
  echo.delayTime.value = 0.32;
  const echoFeedback = context.createGain();
  echoFeedback.gain.value = 0.32;
  const echoTone = context.createBiquadFilter();
  echoTone.type = 'lowpass';
  echoTone.frequency.value = 2600;
  echo.connect(echoTone).connect(echoFeedback).connect(echo);
  echoTone.connect(master);

  return { master, windFilter, windGain, rustleGain, echo };
}

/**
 * button：右下角的聲音開關（aria-pressed 反映狀態）。
 * 回傳 { chime(), get enabled }。
 */
export function createAmbience({ button }) {
  let context = null;
  let graph = null;
  let enabled = false;
  let timers = [];

  const clear = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  // 陣風：每 2–5 秒換一個新的目標音量與亮度，慢慢滑過去
  function gust() {
    if (!enabled) return;
    const now = context.currentTime;
    const strength = 0.25 + Math.random() * 0.75;
    graph.windGain.gain.setTargetAtTime(0.25 + strength * 0.5, now, 1.2);
    graph.windFilter.frequency.setTargetAtTime(220 + strength * 520, now, 1.5);
    timers.push(setTimeout(gust, 2000 + Math.random() * 3000));
  }

  // 沙沙：一陣陣短包絡，風強的時候比較密
  function rustle() {
    if (!enabled) return;
    const now = context.currentTime;
    const peak = 0.05 + Math.random() * 0.12;
    const length = 0.25 + Math.random() * 0.9;
    const gain = graph.rustleGain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(peak, now + length * 0.3);
    gain.linearRampToValueAtTime(0.004, now + length);
    timers.push(setTimeout(rustle, (length + 0.2 + Math.random() * 2.2) * 1000));
  }

  function setButton() {
    if (!button) return;
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', enabled ? '關閉環境音' : '開啟環境音');
    button.title = enabled ? '關閉環境音' : '開啟環境音';
  }

  async function turnOn() {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!context) {
      context = new AudioContextClass();
      graph = buildGraph(context);
    }
    await context.resume();
    enabled = true;
    graph.master.gain.setTargetAtTime(MASTER_LEVEL, context.currentTime, 0.6);
    gust();
    rustle();
  }

  function turnOff() {
    enabled = false;
    clear();
    if (!context) return;
    graph.master.gain.setTargetAtTime(0, context.currentTime, 0.25);
    const current = context;
    timers.push(
      setTimeout(() => {
        if (!enabled) current.suspend();
      }, 1200),
    );
  }

  button?.addEventListener('click', async () => {
    if (enabled) turnOff();
    else await turnOn().catch((error) => console.warn('無法啟用環境音', error));
    setButton();
  });
  setButton();

  return {
    /** 留下楓葉時的「叮」：只有使用者開了聲音才會響 */
    chime() {
      if (!enabled || !context) return;
      const now = context.currentTime;
      // 鐘聲的泛音（略不和諧）與各自的衰減時間
      for (const [ratio, level, decay] of [
        [1, 0.16, 2.4],
        [2.76, 0.06, 1.3],
        [5.4, 0.03, 0.7],
        [0.5, 0.04, 2.8],
      ]) {
        const osc = context.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 1046.5 * ratio;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(level, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
        osc.connect(gain);
        gain.connect(graph.master);
        gain.connect(graph.echo);
        osc.start(now);
        osc.stop(now + decay + 0.05);
      }
    },
    get enabled() {
      return enabled;
    },
  };
}
