// Lumora — shared state model.
//
// The whole show is described by one plain JSON object. The main process owns
// the authoritative copy; every window (control, outputs, and later phone
// remotes) receives the full state and renders from it. Changes only happen
// through `reduce(state, action, now)`, which is pure apart from the `now`
// timestamp passed in, so every window can compute identical animations.

export const SCREENS = ['live', 'back', 'monitor'];

export const SCREEN_NAMES = {
  live: 'Live Screen',
  back: 'Back Screen',
  monitor: 'Monitor',
};

export const TRANSITIONS = [
  { type: 'cut', name: 'Cut' },
  { type: 'fade', name: 'Fade' },
  { type: 'merge', name: 'Merge' },
  { type: 'dip', name: 'Dip to Black' },
  { type: 'wipe', name: 'Wipe' },
  { type: 'slide', name: 'Slide' },
];

export const SOURCE_TYPES = ['camera', 'video', 'image', 'color', 'pattern'];

const TRANSITION_TYPES = new Set(TRANSITIONS.map((t) => t.type));
const MIN_DURATION = 100;
const MAX_DURATION = 10000;
export const BLANK_FADE_MS = 300;
export const FLASH_MS = 2400;

function emptyScreen() {
  return {
    preview: null, // source id shown in the preview monitor
    program: null, // source id currently on air
    prev: null, // outgoing source during a transition
    trans: null, // { type, duration, at } of the last take
    tbar: 0, // manual fader position 0..1
    blank: false,
    blankAt: 0,
    flashAt: 0,
  };
}

export function createInitialState() {
  return {
    version: 1,
    sources: {},
    sourceOrder: [],
    screens: Object.fromEntries(SCREENS.map((s) => [s, emptyScreen()])),
    transition: { type: 'fade', duration: 800 },
    panic: false,
    panicAt: 0,
    audio: { master: 1 },
    outputs: Object.fromEntries(SCREENS.map((s) => [s, { open: false, displayId: null }])),
    settings: {
      // Which physical display each screen goes to. Set once, remembered.
      displays: { live: null, back: null, monitor: null },
      autoPlayOnTake: true,
    },
  };
}

// ---------- helpers ----------

let idCounter = 0;
export function newId(prefix = 'src') {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function isScreen(s) {
  return SCREENS.includes(s);
}

/** Current playback position (seconds) of a video source at time `now`. */
export function sourcePosition(src, now) {
  const p = src && src.play;
  if (!p) return 0;
  let pos = p.playing ? p.pos + (now - p.at) / 1000 : p.pos;
  const d = src.duration;
  if (d > 0) {
    if (src.loop) pos = ((pos % d) + d) % d;
    else pos = Math.min(pos, d);
  }
  return Math.max(0, pos);
}

/** True when a non-looping video has played to its end. */
export function sourceEnded(src, now) {
  return !!(src && src.type === 'video' && !src.loop && src.duration > 0 && sourcePosition(src, now) >= src.duration - 0.05);
}

/** Progress 0..1 of a screen's current transition. */
export function transitionProgress(screen, now) {
  const t = screen && screen.trans;
  if (!t || !screen.prev || t.type === 'cut') return 1;
  return clamp((now - t.at) / t.duration, 0, 1);
}

function sanitizeSource(src) {
  const out = {
    id: String(src.id || newId()),
    type: SOURCE_TYPES.includes(src.type) ? src.type : 'color',
    name: String(src.name || 'Untitled').slice(0, 80),
    volume: clamp(src.volume ?? 1, 0, 1),
    muted: !!src.muted,
    loop: !!src.loop,
    fit: src.fit === 'cover' ? 'cover' : 'contain',
  };
  if (out.type === 'camera') {
    out.deviceId = String(src.deviceId || '');
    out.label = String(src.label || '');
  }
  if (out.type === 'video' || out.type === 'image') {
    out.url = String(src.url || '');
    out.path = String(src.path || '');
  }
  if (out.type === 'video') {
    out.duration = clamp(src.duration ?? 0, 0, 1e7);
    out.play = { playing: false, pos: 0, at: 0 };
  }
  if (out.type === 'color') out.color = /^#[0-9a-f]{6}$/i.test(src.color) ? src.color : '#000000';
  return out;
}

function startIfVideo(s, id, now) {
  const src = s.sources[id];
  if (!src || src.type !== 'video' || !s.settings.autoPlayOnTake) return;
  if (src.play.playing && !sourceEnded(src, now)) return;
  const pos = sourceEnded(src, now) ? 0 : sourcePosition(src, now);
  src.play = { playing: true, pos, at: now };
}

function take(s, screenId, trans, now) {
  const sc = s.screens[screenId];
  if (!sc.preview || !s.sources[sc.preview]) return;
  const incoming = sc.preview;
  const outgoing = sc.program;
  sc.prev = outgoing && outgoing !== incoming ? outgoing : null;
  sc.program = incoming;
  // Standard broadcast behaviour: what was on air drops back into preview.
  sc.preview = outgoing || incoming;
  sc.trans = { type: trans.type, duration: trans.duration, at: now };
  sc.tbar = 0;
  startIfVideo(s, incoming, now);
}

// ---------- reducer ----------

/**
 * Apply one action. Returns a NEW state object (the input is never mutated),
 * or the same object if the action changed nothing / was invalid.
 */
export function reduce(state, action, now = Date.now()) {
  if (!action || typeof action.type !== 'string') return state;
  const s = structuredClone(state);
  const a = action;

  switch (a.type) {
    case 'ADD_SOURCE': {
      if (!a.source) return state;
      const src = sanitizeSource(a.source);
      if (s.sources[src.id]) return state;
      s.sources[src.id] = src;
      s.sourceOrder.push(src.id);
      return s;
    }
    case 'UPDATE_SOURCE': {
      const src = s.sources[a.id];
      if (!src || !a.patch) return state;
      const allowed = ['name', 'volume', 'muted', 'loop', 'fit', 'color'];
      const merged = { ...src };
      for (const k of allowed) if (k in a.patch) merged[k] = a.patch[k];
      const clean = sanitizeSource(merged);
      // keep runtime fields sanitize would reset
      if (src.type === 'video') {
        clean.play = src.play;
        clean.duration = src.duration;
      }
      s.sources[a.id] = clean;
      return s;
    }
    case 'REMOVE_SOURCE': {
      if (!s.sources[a.id]) return state;
      delete s.sources[a.id];
      s.sourceOrder = s.sourceOrder.filter((x) => x !== a.id);
      for (const sc of Object.values(s.screens)) {
        for (const k of ['preview', 'program', 'prev']) if (sc[k] === a.id) sc[k] = null;
      }
      return s;
    }
    case 'MOVE_SOURCE': {
      const i = s.sourceOrder.indexOf(a.id);
      if (i < 0) return state;
      const j = clamp(Math.round(a.index), 0, s.sourceOrder.length - 1);
      s.sourceOrder.splice(i, 1);
      s.sourceOrder.splice(j, 0, a.id);
      return s;
    }
    case 'SET_PREVIEW': {
      if (!isScreen(a.screen)) return state;
      if (a.sourceId !== null && !s.sources[a.sourceId]) return state;
      s.screens[a.screen].preview = a.sourceId;
      s.screens[a.screen].tbar = 0;
      return s;
    }
    case 'TAKE': {
      if (!isScreen(a.screen)) return state;
      const t = a.transition || s.transition;
      const type = TRANSITION_TYPES.has(t.type) ? t.type : 'cut';
      take(s, a.screen, { type, duration: clamp(t.duration, MIN_DURATION, MAX_DURATION) }, now);
      return s;
    }
    case 'CUT_TO': {
      // Send a source straight to air (skipping preview), using a cut.
      if (!isScreen(a.screen) || !s.sources[a.sourceId]) return state;
      const sc = s.screens[a.screen];
      const keepPreview = sc.preview;
      sc.preview = a.sourceId;
      take(s, a.screen, { type: 'cut', duration: MIN_DURATION }, now);
      sc.preview = keepPreview ?? sc.preview;
      return s;
    }
    case 'SET_TBAR': {
      if (!isScreen(a.screen)) return state;
      const sc = s.screens[a.screen];
      const v = clamp(a.value, 0, 1);
      if (!sc.preview) return state;
      if (v >= 0.999) {
        // Fader pushed all the way: the preview is now fully on air.
        take(s, a.screen, { type: 'cut', duration: MIN_DURATION }, now);
      } else {
        sc.tbar = v;
        if (v > 0) startIfVideo(s, sc.preview, now);
      }
      return s;
    }
    case 'SET_TRANSITION': {
      if (a.transitionType !== undefined && TRANSITION_TYPES.has(a.transitionType)) s.transition.type = a.transitionType;
      if (a.duration !== undefined) s.transition.duration = clamp(a.duration, MIN_DURATION, MAX_DURATION);
      return s;
    }
    case 'SET_BLANK': {
      const list = (a.screens || []).filter(isScreen);
      if (!list.length) return state;
      for (const id of list) {
        const sc = s.screens[id];
        if (sc.blank !== !!a.value) {
          sc.blank = !!a.value;
          sc.blankAt = now;
        }
      }
      return s;
    }
    case 'PANIC': {
      const v = !!a.value;
      if (s.panic === v) return state;
      s.panic = v;
      s.panicAt = now;
      return s;
    }
    case 'MONITOR_FLASH': {
      s.screens.monitor.flashAt = now;
      return s;
    }
    case 'PLAY':
    case 'PAUSE': {
      const src = s.sources[a.id];
      if (!src || src.type !== 'video') return state;
      const playing = a.type === 'PLAY';
      let pos = sourcePosition(src, now);
      if (playing && sourceEnded(src, now)) pos = 0;
      src.play = { playing, pos, at: now };
      return s;
    }
    case 'SEEK': {
      const src = s.sources[a.id];
      if (!src || src.type !== 'video') return state;
      const max = src.duration > 0 ? src.duration : 1e7;
      src.play = { playing: src.play.playing, pos: clamp(a.pos, 0, max), at: now };
      return s;
    }
    case 'SET_DURATION': {
      const src = s.sources[a.id];
      const d = Number(a.duration);
      if (!src || src.type !== 'video' || !(d > 0) || Math.abs(src.duration - d) < 0.01) return state;
      src.duration = d;
      return s;
    }
    case 'SET_MASTER': {
      s.audio.master = clamp(a.value, 0, 1);
      return s;
    }
    case 'SET_OUTPUT': {
      if (!isScreen(a.screen)) return state;
      s.outputs[a.screen] = { open: !!a.open, displayId: a.displayId ?? null };
      return s;
    }
    case 'SET_DISPLAY': {
      if (!isScreen(a.screen)) return state;
      s.settings.displays[a.screen] = a.displayId ?? null;
      return s;
    }
    case 'SET_SETTING': {
      if (a.key === 'autoPlayOnTake') s.settings.autoPlayOnTake = !!a.value;
      else return state;
      return s;
    }
    default:
      return state;
  }
}

// ---------- persistence ----------

/** Strip runtime-only fields before saving to disk. */
export function toSaved(state) {
  const s = structuredClone(state);
  for (const sc of Object.values(s.screens)) {
    sc.prev = null;
    sc.trans = null;
    sc.tbar = 0;
    sc.flashAt = 0;
  }
  s.panic = false;
  for (const src of Object.values(s.sources)) {
    if (src.play) src.play = { playing: false, pos: 0, at: 0 };
  }
  for (const k of Object.keys(s.outputs)) s.outputs[k] = { open: false, displayId: null };
  return s;
}

/** Load saved JSON defensively: anything malformed falls back to defaults. */
export function fromSaved(saved) {
  const base = createInitialState();
  if (!saved || typeof saved !== 'object') return base;
  try {
    const sources = {};
    const order = [];
    for (const id of Array.isArray(saved.sourceOrder) ? saved.sourceOrder : []) {
      const raw = saved.sources && saved.sources[id];
      if (!raw) continue;
      const src = sanitizeSource({ ...raw, id });
      if (src.type === 'video') src.duration = clamp(raw.duration ?? 0, 0, 1e7);
      sources[id] = src;
      order.push(id);
    }
    base.sources = sources;
    base.sourceOrder = order;
    for (const id of SCREENS) {
      const sc = saved.screens && saved.screens[id];
      if (!sc) continue;
      const ok = (x) => (x && sources[x] ? x : null);
      base.screens[id].preview = ok(sc.preview);
      base.screens[id].program = ok(sc.program);
      base.screens[id].blank = !!sc.blank;
    }
    if (saved.transition) {
      if (TRANSITION_TYPES.has(saved.transition.type)) base.transition.type = saved.transition.type;
      base.transition.duration = clamp(saved.transition.duration ?? 800, MIN_DURATION, MAX_DURATION);
    }
    if (saved.audio) base.audio.master = clamp(saved.audio.master ?? 1, 0, 1);
    if (saved.settings) {
      for (const id of SCREENS) {
        const d = saved.settings.displays && saved.settings.displays[id];
        base.settings.displays[id] = d ?? null;
      }
      if ('autoPlayOnTake' in saved.settings) base.settings.autoPlayOnTake = !!saved.settings.autoPlayOnTake;
    }
  } catch {
    return createInitialState();
  }
  return base;
}
