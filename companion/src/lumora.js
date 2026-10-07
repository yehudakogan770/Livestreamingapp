// What the Lumora module does, kept apart from Companion so it can be tested:
// the actions and the commands they send, reading the tally, the presets,
// and how long to wait before connecting again. See docs/API.md.

const STATE = {
  type: 'dropdown',
  id: 'state',
  label: 'On or off',
  default: 'toggle',
  choices: [
    { id: 'toggle', label: 'Toggle' },
    { id: 'on', label: 'On' },
    { id: 'off', label: 'Off' },
  ],
};
const SCREEN = {
  type: 'dropdown',
  id: 'screen',
  label: 'Screen',
  default: 'live',
  choices: [
    { id: 'live', label: 'Live Screen' },
    { id: 'back', label: 'Back Screen' },
  ],
};
const INPUT = { type: 'textinput', id: 'input', label: 'Input number or name', default: '1', useVariables: true };
const TO = (label) => ({ type: 'textinput', id: 'to', label, default: 'next' });

/** The actions: id → name, the command it sends and its options. */
export const ACTIONS = {
  take: { name: 'Take (with the transition)', cmd: 'take', options: [SCREEN] },
  cut: { name: 'Cut', cmd: 'cut', options: [SCREEN] },
  preview: { name: 'Input into Next (preview)', cmd: 'preview', options: [INPUT, SCREEN] },
  program: { name: 'Input on air at once (program)', cmd: 'cutto', options: [INPUT, SCREEN] },
  playnow: { name: 'Input into Next and take', cmd: 'playnow', options: [INPUT, SCREEN] },
  overlay: {
    name: 'Overlay on / off',
    cmd: 'overlay',
    options: [{ type: 'number', id: 'channel', label: 'Overlay', default: 1, min: 1, max: 4 }, STATE],
  },
  overlaysoff: { name: 'Every overlay off', cmd: 'overlaysoff', options: [] },
  blank: { name: 'Black out a screen', cmd: 'blank', options: [SCREEN, STATE] },
  ftb: { name: 'Fade to black', cmd: 'ftb', options: [SCREEN] },
  record: { name: 'Recording start / stop', cmd: 'record', options: [STATE] },
  stream: { name: 'Stream start / stop', cmd: 'stream', options: [STATE] },
  replay: {
    name: 'Instant replay',
    cmd: 'replay',
    options: [
      { type: 'number', id: 'seconds', label: 'Seconds', default: 8, min: 1, max: 60 },
      { type: 'checkbox', id: 'slow', label: 'Half speed', default: false },
    ],
  },
  slide: { name: 'Slides: next / previous', cmd: 'slide', options: [INPUT, TO('next, previous or a slide number')] },
  preset: { name: 'Run a preset', cmd: 'preset', options: [{ type: 'number', id: 'number', label: 'Preset', default: 1, min: 1, max: 99 }] },
  nextpreset: { name: 'Next preset', cmd: 'nextpreset', options: [] },
  previouspreset: { name: 'Previous preset', cmd: 'previouspreset', options: [] },
  macro: { name: 'Run a macro', cmd: 'macro', options: [{ type: 'textinput', id: 'name', label: 'Macro name or number', default: '1' }] },
  stopmacros: { name: 'Stop every macro', cmd: 'stopmacros', options: [] },
  timer: {
    name: 'Countdown',
    cmd: 'timer',
    options: [
      {
        type: 'dropdown',
        id: 'do',
        label: 'Do',
        default: 'toggle',
        choices: ['start', 'pause', 'toggle', 'reset', 'add'].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
      },
      { type: 'number', id: 'minutes', label: 'Minutes (for add / reset)', default: 1, min: -60, max: 600 },
    ],
  },
  datarow: { name: 'Data row: next / previous', cmd: 'datarow', options: [TO('next, previous or a row number')] },
  nextcue: { name: 'Next cue (run of show)', cmd: 'nextcue', options: [] },
  panic: { name: 'PANIC', cmd: 'panic', options: [STATE] },
};

/** An input given as a number or a name. */
function inputValue(v) {
  const t = String(v ?? '').trim();
  return /^\d+$/.test(t) ? { input: t } : { name: t };
}

/** The WebSocket message an action sends. */
export function commandFor(actionId, options = {}) {
  const a = ACTIONS[actionId];
  if (!a) return null;
  const msg = { cmd: a.cmd };
  for (const o of a.options) {
    const v = options[o.id] ?? o.default;
    if (o.id === 'input') Object.assign(msg, inputValue(v));
    else if (o.id === 'name' && actionId === 'macro') Object.assign(msg, /^\d+$/.test(String(v).trim()) ? { number: String(v).trim() } : { name: String(v) });
    else if (o.type === 'checkbox') {
      if (v) msg[o.id] = '1';
    } else if (o.id === 'minutes' && !['add', 'reset'].includes(String(options.do ?? 'toggle'))) continue;
    else msg[o.id] = String(v);
  }
  return msg;
}

/** One input's tally: 'program', 'preview' or 'off'. `which` is a number or a name. */
export function tallyOf(tally, which) {
  const inputs = tally?.inputs ?? [];
  const t = String(which ?? '').trim();
  const i = /^\d+$/.test(t) ? inputs.find((x) => x.number === Number(t)) : inputs.find((x) => String(x.name).toLowerCase() === t.toLowerCase());
  if (!i) return 'off';
  return i.program ? 'program' : i.preview ? 'preview' : 'off';
}

/** Companion variables from the tally. */
export function variablesOf(tally) {
  const v = {
    program: tally?.live?.programName ?? '',
    preview: tally?.live?.previewName ?? '',
    program_number: tally?.live?.program ?? '',
    preview_number: tally?.live?.preview ?? '',
    recording: tally?.recording ? 'on' : 'off',
    streaming: tally?.streaming ? 'on' : tally?.reconnecting ? `reconnecting (${tally.reconnecting})` : 'off',
  };
  for (const i of tally?.inputs ?? []) v[`input_${i.number}_name`] = i.name ?? '';
  return v;
}

/** Wait before connecting again: 1, 2, 4, 8 … up to 30 seconds. */
export function retryDelay(attempt) {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}

/** The WebSocket address. */
export function socketUrl(config) {
  const host = String(config.host || '127.0.0.1').trim();
  const port = Number(config.port) || 8095;
  return `ws://${host}:${port}/api/ws?token=${encodeURIComponent(String(config.token ?? '').trim())}`;
}

const WHITE = 0xffffff;
const BLACK = 0x000000;
const RED = 0xcc0000;
const GREEN = 0x009900;
const AMBER = 0xcc7a00;

/** Ready-made buttons. */
export function presetsFor(inputs = 8) {
  const p = {};
  const button = (category, name, text, actionId, options, feedbacks = [], bg = BLACK) => ({
    type: 'button',
    category,
    name,
    style: { text, size: 'auto', color: WHITE, bgcolor: bg },
    steps: [{ down: [{ actionId, options }], up: [] }],
    feedbacks,
  });
  for (let n = 1; n <= inputs; n++) {
    p[`preview_${n}`] = button('Inputs', `Input ${n} into Next`, `$(lumora:input_${n}_name)`, 'preview', { input: String(n), screen: 'live' }, [
      { feedbackId: 'tally', options: { input: String(n), state: 'program' }, style: { bgcolor: RED, color: WHITE } },
      { feedbackId: 'tally', options: { input: String(n), state: 'preview' }, style: { bgcolor: GREEN, color: WHITE } },
    ]);
  }
  p.take = button('Switching', 'Take', 'TAKE', 'take', { screen: 'live' });
  p.cut = button('Switching', 'Cut', 'CUT', 'cut', { screen: 'live' });
  for (let n = 1; n <= 4; n++) {
    p[`overlay_${n}`] = button('Overlays', `Overlay ${n}`, `OVL ${n}`, 'overlay', { channel: n, state: 'toggle' }, [
      { feedbackId: 'overlay', options: { channel: n }, style: { bgcolor: RED, color: WHITE } },
    ]);
  }
  p.record = button('Recording and streaming', 'Record', 'REC', 'record', { state: 'toggle' }, [
    { feedbackId: 'recording', options: {}, style: { bgcolor: RED, color: WHITE } },
  ]);
  p.stream = button('Recording and streaming', 'Stream', 'LIVE', 'stream', { state: 'toggle' }, [
    { feedbackId: 'streaming', options: {}, style: { bgcolor: RED, color: WHITE } },
    { feedbackId: 'reconnecting', options: {}, style: { bgcolor: AMBER, color: BLACK } },
  ]);
  p.replay = button('Recording and streaming', 'Replay 8 seconds', 'REPLAY', 'replay', { seconds: 8, slow: false });
  p.slide_next = button('Slides', 'Next slide', 'SLIDE ▶', 'slide', { input: '1', to: 'next' });
  p.slide_prev = button('Slides', 'Previous slide', '◀ SLIDE', 'slide', { input: '1', to: 'previous' });
  p.timer = button('Countdown', 'Start / pause the countdown', 'TIMER', 'timer', { do: 'toggle' });
  p.panic = button('Safety', 'PANIC', 'PANIC', 'panic', { state: 'toggle' }, [{ feedbackId: 'panic', options: {}, style: { bgcolor: RED, color: WHITE } }]);
  return p;
}
