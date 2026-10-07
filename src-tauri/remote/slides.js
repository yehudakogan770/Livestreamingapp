// @ts-check
// Lumora Slides: the speaker's clicker on a phone, tablet or laptop. Served
// by the app itself (src-tauri/src/remote.rs, `/slides`), with no build step.
// It only ever gets the slides (see speaker.rs), and with the speaker PIN it
// can only change them.

import {
  actionFor,
  clickerKey,
  clockText,
  describe,
  elapsedText,
  nextIndex,
  pickSlideshow,
  pinFromHash,
  predict,
  remaining,
  slideLabel,
  swipe,
  timeOfDay,
} from './slides-core.js';

/** @typedef {import('./slides-core.js').SlidesView} SlidesView */
/** @typedef {import('./slides-core.js').ViewSlideshow} ViewSlideshow */
/** @typedef {import('./slides-core.js').Move} Move */

const PIN_KEY = 'lumora.slides.pin';
const PICK_KEY = 'lumora.slides.pick';
const START_KEY = 'lumora.slides.start';

/** @param {string} id */
function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

/** @param {Storage} store @param {string} key */
function read(store, key) {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/** @param {Storage} store @param {string} key @param {string} value */
function write(store, key, value) {
  try {
    store.setItem(key, value);
  } catch {
    /* private browsing: asked again next time */
  }
}

// The QR code carries the PIN after "#": keep it, and take it out of the address bar.
const fromQr = pinFromHash(location.hash);
if (fromQr) {
  write(localStorage, PIN_KEY, fromQr);
  history.replaceState(null, '', location.pathname);
}

/** The speaker PIN, or (on the operator's phone) the phone remote's PIN. */
let pin = read(localStorage, PIN_KEY) ?? read(localStorage, 'lumora.remote.pin') ?? '';
/** @type {SlidesView | null} */
let view = null;
/** The computer's clock minus ours, so the countdown matches the screens. */
let offset = 0;
/** @type {string | null} */
let chosen = read(sessionStorage, PICK_KEY);
/** @type {EventSource | null} */
let events = null;
/** A tap shows straight away; the computer's answer replaces it. @type {{ sh: ViewSlideshow, until: number } | null} */
let guess = null;
let started = Number(read(sessionStorage, START_KEY)) || Date.now();
write(sessionStorage, START_KEY, String(started));

const now = () => Date.now() + offset;

// ------------------------------------------------------------------ talking to the computer

/** @param {string} path @param {RequestInit} [init] */
function call(path, init = {}) {
  return fetch(path, { ...init, headers: { 'Content-Type': 'application/json', 'X-Lumora-Pin': pin, ...init.headers } });
}

/** @param {string} [message] */
function needPin(message = '') {
  events?.close();
  events = null;
  $('app').hidden = true;
  $('login').hidden = false;
  $('login-error').textContent = message;
  /** @type {HTMLInputElement} */ ($('pin')).value = '';
}

/** @param {Response} res */
async function refusal(res) {
  const err = await res.json().catch(() => ({}));
  return describe(/** @type {{ code?: string }} */ (err).code);
}

async function login() {
  try {
    const res = await call('/api/check', { method: 'POST' });
    if (!res.ok) return needPin(pin || res.status !== 401 ? await refusal(res) : '');
  } catch {
    return needPin('Could not reach the computer. Is this device on the same Wi-Fi?');
  }
  write(localStorage, PIN_KEY, pin);
  $('login').hidden = true;
  $('app').hidden = false;
  connect();
  void keepAwake();
}

function connect() {
  events?.close();
  const es = new EventSource(`/api/events?view=slides&pin=${encodeURIComponent(pin)}`);
  events = es;
  es.addEventListener('slides', (e) => {
    const data = JSON.parse(/** @type {MessageEvent} */ (e).data);
    offset = data.now - Date.now();
    view = data.view;
    guess = null;
    online(true);
    render();
  });
  es.addEventListener('ping', (e) => {
    offset = JSON.parse(/** @type {MessageEvent} */ (e).data).now - Date.now();
    online(true);
  });
  es.onerror = () => {
    online(false);
    // The browser tries again by itself; find out if the PIN changed or this device was disconnected.
    void call('/api/check', { method: 'POST' })
      .then(async (res) => {
        if (res.status === 401 || res.status === 410) needPin(await refusal(res));
      })
      .catch(() => {});
  };
}

/** @param {boolean} ok */
function online(ok) {
  $('conn').classList.toggle('conn--ok', ok);
  $('offline').hidden = ok;
}

/** @param {Move} m */
async function move(m) {
  const sh = current();
  if (!sh || !view || view.locked) {
    if (view?.locked) toast(describe('speakerLocked'));
    return;
  }
  if (m === 'black' && !view.allowBlack) return toast(describe('blackNotAllowed'));
  guess = { sh: predict(sh, m), until: Date.now() + 1500 };
  render();
  navigator.vibrate?.(15);
  await send(actionFor(m, sh));
}

/** @param {number} index */
async function jump(index) {
  const sh = current();
  if (!sh || !view || view.locked) return;
  guess = { sh: { ...sh, current: index, black: false }, until: Date.now() + 1500 };
  render();
  await send({ type: 'slideGo', id: sh.id, index });
}

/** @param {Record<string, unknown>} action */
async function send(action) {
  try {
    const res = await call('/api/action', { method: 'POST', body: JSON.stringify(action) });
    if (res.ok) return;
    guess = null;
    render();
    if (res.status === 401 || res.status === 410) return needPin(await refusal(res));
    toast(await refusal(res));
  } catch {
    guess = null;
    render();
    toast('Could not reach the computer. Check the Wi-Fi.');
  }
}

/** The screen stays on while the speaker uses it (where the browser can). */
async function keepAwake() {
  try {
    const lock = /** @type {{ wakeLock?: { request(type: 'screen'): Promise<unknown> } }} */ (navigator).wakeLock;
    await lock?.request('screen');
  } catch {
    /* not allowed here: the phone may dim as usual */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && events) void keepAwake();
});

// ------------------------------------------------------------------ drawing

/** The slideshow shown, with a tap's guess until the computer answers. */
function current() {
  const sh = pickSlideshow(view, chosen);
  if (guess && sh && guess.sh.id === sh.id && Date.now() < guess.until) return guess.sh;
  return sh;
}

/** @param {string} text */
function esc(text) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A slide's picture (or the input's name). @param {ViewSlideshow} sh @param {number} i */
function slideHtml(sh, i) {
  const sl = sh.slides[i];
  if (!sl) return '<span class="frame__empty">End of the slides</span>';
  if (sl.type === 'input') return `<span class="frame__input">${esc(sl.name || 'An input')}</span>`;
  const src = `/api/slide-picture?id=${encodeURIComponent(sh.id)}&n=${i}&v=${sl.v}&pin=${encodeURIComponent(pin)}`;
  return `<img src="${esc(src)}" alt="Slide ${i + 1}" draggable="false" />`;
}

/** Only changed when it changed (so pictures don't flicker). @param {HTMLElement} el @param {string} html */
function put(el, html) {
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
}

function render() {
  if (!view) return;
  $('event').textContent = view.event || 'Lumora';
  $('locked').hidden = !view.locked;
  const pick = /** @type {HTMLSelectElement} */ ($('pick'));
  pick.hidden = view.slideshows.length < 2;
  const sh = current();
  const options = view.slideshows.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}${s.onAir ? ' (on air)' : ''}</option>`).join('');
  if (pick.dataset.html !== options) {
    pick.innerHTML = options;
    pick.dataset.html = options;
  }
  if (sh) pick.value = sh.id;

  const disabled = !sh || view.locked || sh.slides.length === 0;
  for (const id of ['prev', 'go', 'all', 'black']) /** @type {HTMLButtonElement} */ ($(id)).disabled = disabled;
  $('black').hidden = !view.allowBlack;
  if (!sh) {
    put($('now'), '<span class="frame__empty">There is no slideshow yet. The operator adds one on the computer.</span>');
    put($('next'), '');
    $('where').textContent = 'No slideshow';
    $('tag').hidden = true;
    $('black-tag').hidden = true;
    $('notes-box').hidden = true;
    return;
  }
  put($('now'), sh.slides.length ? slideHtml(sh, sh.current) : '<span class="frame__empty">No slides yet</span>');
  $('now').classList.toggle('frame--black', sh.black);
  const n = nextIndex(sh);
  put($('next'), n === null ? '<span class="frame__empty">End of the slides</span>' : slideHtml(sh, n));
  $('where').textContent = slideLabel(sh);
  $('tag').hidden = !sh.onAir && !sh.inNext;
  $('tag').textContent = sh.onAir ? 'ON AIR' : 'NEXT';
  $('tag').className = `tag ${sh.onAir ? 'tag--air' : 'tag--next'}`;
  $('black-tag').hidden = !sh.black;
  $('black').classList.toggle('btn--on', sh.black);
  $('black').textContent = sh.black ? 'Show the slides' : 'Black screen';
  $('go').textContent = n === null && !sh.black ? 'Last slide' : 'Next ›';
  const notes = sh.slides[sh.current]?.notes ?? '';
  $('notes-box').hidden = !sh.slides.some((s) => s.notes);
  $('notes').textContent = notes || 'No notes for this slide.';
  $('notes').classList.toggle('notes--none', !notes);
  if (!$('grid-sheet').hidden) renderGrid();
}

function renderGrid() {
  const sh = current();
  if (!sh) return;
  put(
    $('grid'),
    sh.slides
      .map(
        (_, i) =>
          `<button type="button" class="grid__slide${i === sh.current ? ' is-now' : ''}" data-index="${i}" aria-label="Slide ${i + 1}">${slideHtml(sh, i)}<i>${i + 1}</i></button>`,
      )
      .join(''),
  );
}

function tick() {
  $('elapsed-time').textContent = elapsedText(Date.now() - started);
  $('clock').textContent = timeOfDay(now());
  const cd = view?.countdown;
  $('cd').hidden = !cd;
  if (cd) {
    $('cd-name').textContent = cd.name || 'Countdown';
    $('cd-time').textContent = clockText(remaining(cd, now()));
  }
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;
/** @param {string} text */
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

// ------------------------------------------------------------------ wiring

$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  pin = /** @type {HTMLInputElement} */ ($('pin')).value.trim();
  void login();
});
$('go').addEventListener('click', () => void move('next'));
$('prev').addEventListener('click', () => void move('previous'));
$('black').addEventListener('click', () => void move('black'));
$('pick').addEventListener('change', (e) => {
  chosen = /** @type {HTMLSelectElement} */ (e.target).value;
  write(sessionStorage, PICK_KEY, chosen);
  render();
});
$('elapsed').addEventListener('click', () => {
  started = Date.now();
  write(sessionStorage, START_KEY, String(started));
  tick();
  toast('Elapsed time starts again from 0:00.');
});
$('all').addEventListener('click', () => {
  $('grid-sheet').hidden = false;
  renderGrid();
  document.querySelector('.grid__slide.is-now')?.scrollIntoView({ block: 'center' });
});
$('grid-close').addEventListener('click', () => ($('grid-sheet').hidden = true));
$('grid').addEventListener('click', (e) => {
  const b = /** @type {HTMLElement} */ (e.target).closest('[data-index]');
  if (!(b instanceof HTMLElement)) return;
  $('grid-sheet').hidden = true;
  void jump(Number(b.dataset.index));
});

// Tap the slide for the next one; swipe left (next) or right (back) anywhere on the slides.
{
  const area = $('now');
  /** @type {{ x: number, y: number, t: number } | null} */
  let start = null;
  for (const el of [area, $('next')]) {
    el.addEventListener('pointerdown', (e) => (start = { x: e.clientX, y: e.clientY, t: Date.now() }));
    el.addEventListener('pointerup', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const s = swipe(dx, dy, Date.now() - start.t);
      const tapped = el === area && Math.abs(dx) < 10 && Math.abs(dy) < 10;
      start = null;
      if (s) void move(s);
      else if (tapped) void move('next');
    });
  }
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
  });
}

// A presentation clicker paired with this device (it types Page Down, Page Up, B…).
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || $('app').hidden) return;
  const t = e.target;
  if (t instanceof Element && t.closest('input, select, textarea')) return;
  if (e.key === 'Escape' && !$('grid-sheet').hidden) {
    $('grid-sheet').hidden = true;
    return;
  }
  const m = clickerKey(e.key);
  if (!m || e.repeat) return;
  // A focused button already answers Space and Enter.
  if ((e.key === ' ' || e.key === 'Enter') && t instanceof HTMLButtonElement) return;
  e.preventDefault();
  void move(m);
});

setInterval(tick, 250);
tick();
if (pin) void login();
else needPin();
