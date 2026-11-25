import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseInitialTier, createFrameWatch } from '../src/quality.js';

function device(t, { search = '', coarse = false, cores = 8, memory = 8 } = {}) {
  for (const [name, value] of Object.entries({
    window: { location: { search }, matchMedia: (query) => {
      assert.equal(query, '(pointer: coarse)');
      return { matches: coarse };
    } },
    navigator: { hardwareConcurrency: cores, deviceMemory: memory },
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
}

for (const [name, options, isSmallScreen, tier] of [
  ['mobile touch screen', { coarse: true }, true, 'mid'],
  ['large touch screen', { coarse: true }, false, 'mid'],
  ['small screen with fine pointer', {}, true, 'mid'],
  ['high-end desktop', {}, false, 'high'],
  ['four-core desktop', { cores: 4 }, false, 'mid'],
  ['two-core desktop', { cores: 2 }, false, 'mid'],
  ['4 GB desktop', { memory: 4 }, false, 'mid'],
  ['2 GB desktop', { memory: 2 }, false, 'mid'],
  ['desktop above both thresholds', { cores: 5, memory: 5 }, false, 'high'],
  ['desktop with unavailable hardware hints', { cores: null, memory: null }, false, 'high'],
]) {
  test(`chooseInitialTier: ${name} starts at ${tier}`, (t) => {
    device(t, options);
    assert.deepEqual(chooseInitialTier({ isSmallScreen }), { tier, forced: false });
  });
}

for (const tier of ['low', 'high', 'mid']) {
  for (const mobile of [true, false]) {
    test(`chooseInitialTier: ?quality=${tier} forces tier on ${mobile ? 'mobile' : 'desktop'}`, (t) => {
      device(t, { search: `?quality=${tier}`, coarse: mobile });
      assert.deepEqual(chooseInitialTier({ isSmallScreen: mobile }), { tier, forced: true });
    });
  }
}

for (const search of ['?quality=invalid', '?quality=', '?quality=HIGH']) {
  for (const mobile of [true, false]) {
    test(`chooseInitialTier: ${search} falls through on ${mobile ? 'mobile' : 'desktop'}`, (t) => {
      device(t, { search, coarse: mobile });
      assert.deepEqual(chooseInitialTier({ isSmallScreen: mobile }), {
        tier: mobile ? 'mid' : 'high', forced: false,
      });
    });
  }
}

function sample(watch, count, frameMs) {
  for (let i = 0; i < count; i++) watch.sample(frameMs);
}

test('createFrameWatch: warmup contributes neither windows nor strikes', () => {
  const calls = [];
  const watch = createFrameWatch({ onSlow: (ms) => calls.push(ms), warmupMs: 1000, windowMs: 200 });
  sample(watch, 19, 50); // 950 ms: still warming up.
  assert.equal(watch.average, 0);
  assert.deepEqual(calls, []);
  sample(watch, 4, 50); // First measured window (including the warmup boundary frame).
  assert.equal(watch.average, 50);
  assert.deepEqual(calls, []);
  sample(watch, 4, 50);
  assert.deepEqual(calls, [50]);
});

test('createFrameWatch: two consecutive slow windows call onSlow once per pair', () => {
  const calls = [];
  const watch = createFrameWatch({ onSlow: (ms) => calls.push(ms), warmupMs: 0, windowMs: 200 });
  for (let window = 1; window <= 6; window++) {
    sample(watch, 4, 50);
    assert.equal(calls.length, Math.floor(window / 2));
  }
  assert.deepEqual(calls, [50, 50, 50]);
});

test('createFrameWatch: fast windows reset strikes; isolated slow blips do not trigger', () => {
  const calls = [];
  const watch = createFrameWatch({ onSlow: (ms) => calls.push(ms), warmupMs: 0, windowMs: 200 });
  for (let i = 0; i < 3; i++) {
    sample(watch, 4, 50);
    sample(watch, 10, 20);
    assert.equal(watch.average, 20);
    assert.deepEqual(calls, []);
  }
  sample(watch, 4, 50);
  assert.deepEqual(calls, []);
  sample(watch, 4, 50);
  assert.deepEqual(calls, [50]);
  sample(watch, 10, 20);
  assert.deepEqual(calls, [50]);
});
