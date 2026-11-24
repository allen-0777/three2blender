import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTitleIntro, HOLD_MS, FADE_MS } from '../src/titleIntro.js';

function setup(options = {}) {
  const win = new EventTarget();
  const doc = new EventTarget();
  const timers = new Map();
  let next = 0;
  let observer;
  win.setTimeout = (fn, ms) => { timers.set(++next, { fn, ms }); return next; };
  win.clearTimeout = (id) => timers.delete(id);
  win.MutationObserver = class {
    constructor(fn) { observer = this; this.fn = fn; }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  doc.defaultView = win;
  doc.hidden = options.hidden ?? false;
  const classes = new Set();
  const root = { ownerDocument: doc, classList: {
    add: (name) => classes.add(name), remove: (name) => classes.delete(name),
  } };
  const dialogs = [{ open: false }, { open: false }];
  const dismissed = [];
  const intro = createTitleIntro({ root, dialogs, onDismissed: (event) => dismissed.push(event), ...options });
  const fire = (ms) => {
    const entry = [...timers].find(([, timer]) => timer.ms === ms);
    assert.ok(entry, `Expected timer at ${ms}ms`);
    timers.delete(entry[0]); entry[1].fn();
  };
  const key = (key) => { const event = new Event('keydown'); event.key = key; win.dispatchEvent(event); };
  return { intro, win, doc, dialogs, classes, dismissed, timers, fire, key, get observer() { return observer; } };
}

test('hold, fade, then dismiss once; zone stays active through fade', () => {
  const s = setup();
  for (const key of ['Tab', 'Shift', 'Control', 'Alt', 'Meta']) s.key(key);
  assert.equal(s.intro.state, 'visible');
  s.fire(HOLD_MS);
  assert.equal(s.intro.state, 'fading');
  assert.equal(s.intro.zoneActive, true);
  s.intro.dismiss('repeat');
  assert.equal(s.timers.size, 1);
  s.fire(FADE_MS);
  assert.equal(s.intro.state, 'dismissed');
  assert.equal(s.intro.zoneActive, false);
  assert.deepEqual(s.dismissed, [{ animate: true }]);
  assert.ok(s.classes.has('is-title-dismissed'));
  assert.ok(!s.classes.has('is-title-fading'));
  assert.ok(s.observer.disconnected);
});

test('capture pins the zone without timers, observer or interactions', () => {
  const s = setup({ capture: true });
  s.key('Enter'); s.win.dispatchEvent(new Event('pointerdown'));
  s.win.dispatchEvent(new Event('wheel')); s.intro.dismiss('qa');
  assert.equal(s.intro.state, 'pinned');
  assert.equal(s.intro.zoneActive, true);
  assert.equal(s.timers.size, 0);
  assert.equal(s.observer, undefined);
  assert.deepEqual(s.dismissed, []);
});

test('background cancels hold and visibility restarts a full hold', () => {
  const s = setup({ hidden: true });
  assert.equal(s.timers.size, 0);
  s.doc.hidden = false; s.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(s.timers.size, 1);
  s.doc.hidden = true; s.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(s.timers.size, 0);
  s.doc.hidden = false; s.doc.dispatchEvent(new Event('visibilitychange'));
  s.fire(HOLD_MS);
  assert.equal(s.intro.state, 'fading');
});

for (const trigger of ['pointerdown', 'wheel', 'keyboard', 'dialog', 'timer']) {
  test(`reduced motion switches synchronously on ${trigger}`, () => {
    const s = setup({ reducedMotion: true });
    if (trigger === 'keyboard') s.key('Enter');
    else if (trigger === 'dialog') { s.dialogs[0].open = true; s.observer.fn(); }
    else if (trigger === 'timer') s.fire(HOLD_MS);
    else s.win.dispatchEvent(new Event(trigger));
    assert.equal(s.intro.state, 'dismissed');
    assert.equal(s.timers.size, 0);
    assert.ok(!s.classes.has('is-title-fading'));
    assert.deepEqual(s.dismissed, [{ animate: false }]);
  });
}
