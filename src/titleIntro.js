export const HOLD_MS = 3500;
export const FADE_MS = 600;

/** One-way intro; keep the heading in the accessibility tree after dismissal. */
export function createTitleIntro({ root, title, logo, dialogs, capture, reducedMotion, onDismissed }) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  let state = capture ? 'pinned' : 'visible';
  let timer;
  let observer;
  const api = {
    get state() { return state; },
    get zoneActive() { return state !== 'dismissed'; },
    dismiss,
  };
  if (capture) {
    root.classList.add('is-title-pinned');
    return api;
  }

  function teardown() {
    win.clearTimeout(timer);
    doc.removeEventListener('visibilitychange', schedule);
    win.removeEventListener('pointerdown', interact, true);
    win.removeEventListener('wheel', interact, true);
    win.removeEventListener('keydown', keydown, true);
    observer.disconnect();
  }
  function finish() {
    state = 'dismissed';
    root.classList.remove('is-title-fading');
    root.classList.add('is-title-dismissed');
    onDismissed({ animate: !reducedMotion });
  }
  function dismiss(reason) {
    if (state !== 'visible') return;
    teardown();
    if (reducedMotion) finish();
    else {
      state = 'fading';
      root.classList.add('is-title-fading');
      // A dialog may already have made the text transparent: no transitionend then.
      timer = win.setTimeout(finish, FADE_MS);
    }
  }
  function schedule() {
    win.clearTimeout(timer);
    if (!doc.hidden) timer = win.setTimeout(() => dismiss('timer'), HOLD_MS);
  }
  function interact(event) { dismiss(event.type); }
  function keydown(event) {
    if (!['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) dismiss('keyboard');
  }
  observer = new win.MutationObserver(() => {
    if (dialogs.some((dialog) => dialog.open)) dismiss('dialog');
  });
  for (const dialog of dialogs) observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  win.addEventListener('pointerdown', interact, { capture: true, passive: true });
  win.addEventListener('wheel', interact, { capture: true, passive: true });
  win.addEventListener('keydown', keydown, { capture: true });
  doc.addEventListener('visibilitychange', schedule);
  schedule();
  return api;
}
