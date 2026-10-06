// Keyboard shortcuts: every command can be given any keys. Ready-made sets
// follow the big editors (Lumora Studio, Premiere-like, Resolve-like, Final
// Cut-like); changes are kept on this computer. Keys are read by where they
// are on the keyboard, so shortcuts work in any language layout.
import { useSyncExternalStore } from 'react';
import type { Actions } from './actions';
import { panels } from './panels';
import type { Ui } from './state';

export interface Command {
  id: string;
  label: string;
  group: string;
  run: (a: Actions, ui: Ui) => void;
}

const tools: [string, string, Parameters<Actions['tool']>[0]][] = [
  ['toolSelect', 'Selection tool', 'select'],
  ['toolRipple', 'Ripple edit tool', 'ripple'],
  ['toolRoll', 'Rolling edit tool', 'roll'],
  ['toolRazor', 'Razor tool', 'razor'],
  ['toolSlip', 'Slip tool', 'slip'],
  ['toolSlide', 'Slide tool', 'slide'],
  ['toolHand', 'Hand tool', 'hand'],
  ['toolText', 'Type tool', 'text'],
];

export const COMMANDS: Command[] = [
  { id: 'playPause', label: 'Play / pause', group: 'Playback', run: (a) => a.toggle() },
  { id: 'shuttleBack', label: 'Play backward (press again: faster)', group: 'Playback', run: (a) => a.shuttle(-1) },
  { id: 'stop', label: 'Stop', group: 'Playback', run: (a) => a.stop() },
  { id: 'shuttleForward', label: 'Play forward (press again: faster)', group: 'Playback', run: (a) => a.shuttle(1) },
  { id: 'playInToOut', label: 'Play in to out', group: 'Playback', run: (a) => a.playInToOut() },
  { id: 'stepBack', label: 'One frame back', group: 'Navigate', run: (a) => a.step(-1) },
  { id: 'stepForward', label: 'One frame on', group: 'Navigate', run: (a) => a.step(1) },
  { id: 'stepBack5', label: 'Five frames back', group: 'Navigate', run: (a) => a.step(-5) },
  { id: 'stepForward5', label: 'Five frames on', group: 'Navigate', run: (a) => a.step(5) },
  { id: 'prevEdit', label: 'Previous cut', group: 'Navigate', run: (a) => a.toEdit(-1) },
  { id: 'nextEdit', label: 'Next cut', group: 'Navigate', run: (a) => a.toEdit(1) },
  { id: 'home', label: 'Go to the start', group: 'Navigate', run: (a) => a.home() },
  { id: 'end', label: 'Go to the end', group: 'Navigate', run: (a) => a.endOf() },
  { id: 'goToIn', label: 'Go to in', group: 'Navigate', run: (a) => a.toIn() },
  { id: 'goToOut', label: 'Go to out', group: 'Navigate', run: (a) => a.toOut() },
  { id: 'nextMarker', label: 'Next marker', group: 'Navigate', run: (a) => a.toMarker(1) },
  { id: 'prevMarker', label: 'Previous marker', group: 'Navigate', run: (a) => a.toMarker(-1) },
  { id: 'markIn', label: 'Mark in', group: 'Mark', run: (a) => a.markIn() },
  { id: 'markOut', label: 'Mark out', group: 'Mark', run: (a) => a.markOut() },
  { id: 'markClip', label: 'Mark the clip', group: 'Mark', run: (a) => a.markClip() },
  { id: 'clearMarks', label: 'Clear in and out', group: 'Mark', run: (a) => a.clearMarks() },
  { id: 'marker', label: 'Add marker', group: 'Mark', run: (a) => a.marker() },
  { id: 'undo', label: 'Undo', group: 'Edit', run: (a) => a.undo() },
  { id: 'redo', label: 'Redo', group: 'Edit', run: (a) => a.redo() },
  { id: 'cut', label: 'Cut', group: 'Edit', run: (a) => a.cut() },
  { id: 'copy', label: 'Copy', group: 'Edit', run: (a) => a.copy() },
  { id: 'paste', label: 'Paste', group: 'Edit', run: (a) => a.paste() },
  { id: 'pasteInsert', label: 'Paste insert', group: 'Edit', run: (a) => a.paste(true) },
  { id: 'pasteAttributes', label: 'Paste attributes', group: 'Edit', run: (a) => a.pasteAttributes() },
  { id: 'selectAll', label: 'Select all', group: 'Edit', run: (a) => a.selectAll() },
  { id: 'deselect', label: 'Deselect', group: 'Edit', run: (a) => a.deselect() },
  { id: 'selectAtPlayhead', label: 'Select at playhead', group: 'Edit', run: (a) => a.selectAtPlayhead() },
  { id: 'selectForward', label: 'Select everything after the playhead', group: 'Edit', run: (a) => a.selectForward() },
  { id: 'clear', label: 'Clear (leave the gap)', group: 'Edit', run: (a) => a.del() },
  { id: 'rippleDelete', label: 'Ripple delete', group: 'Edit', run: (a) => a.rippleDelete() },
  { id: 'addEdit', label: 'Cut at the playhead', group: 'Timeline', run: (a) => a.addEdit() },
  { id: 'addEditAll', label: 'Cut every track at the playhead', group: 'Timeline', run: (a) => a.addEdit(true) },
  { id: 'trimStart', label: 'Trim start to playhead (ripple)', group: 'Timeline', run: (a) => a.rippleTrim('start') },
  { id: 'trimEnd', label: 'Trim end to playhead (ripple)', group: 'Timeline', run: (a) => a.rippleTrim('end') },
  { id: 'lift', label: 'Lift the marked part', group: 'Timeline', run: (a) => a.liftMarked() },
  { id: 'extract', label: 'Extract the marked part', group: 'Timeline', run: (a) => a.extractMarked() },
  { id: 'insert', label: 'Insert from the source monitor', group: 'Timeline', run: (a) => a.insertSource('insert') },
  { id: 'overwrite', label: 'Overwrite from the source monitor', group: 'Timeline', run: (a) => a.insertSource('overwrite') },
  { id: 'nudgeLeft', label: 'Nudge the selection a frame left', group: 'Timeline', run: (a) => a.nudge(-1) },
  { id: 'nudgeRight', label: 'Nudge the selection a frame right', group: 'Timeline', run: (a) => a.nudge(1) },
  { id: 'videoTransition', label: 'Video transition at the playhead', group: 'Timeline', run: (a) => a.transition('video') },
  { id: 'audioTransition', label: 'Sound crossfade at the playhead', group: 'Timeline', run: (a) => a.transition('audio') },
  { id: 'link', label: 'Link / unlink', group: 'Timeline', run: (a) => a.link() },
  { id: 'toggleEnabled', label: 'Enable / disable clip', group: 'Timeline', run: (a) => a.toggleEnabled() },
  { id: 'speed', label: 'Speed / duration…', group: 'Timeline', run: (_a, ui) => ui.set({ dialog: 'speed' }) },
  { id: 'snapping', label: 'Snapping on / off', group: 'Timeline', run: (a) => a.snapping() },
  { id: 'zoomIn', label: 'Zoom in', group: 'Timeline', run: (a) => a.zoom(1.5) },
  { id: 'zoomOut', label: 'Zoom out', group: 'Timeline', run: (a) => a.zoom(1 / 1.5) },
  {
    id: 'zoomFit',
    label: 'Zoom to see everything',
    group: 'Timeline',
    run: (a) => a.zoomToFit((document.querySelector('.tl__scroll') as HTMLElement | null)?.clientWidth ?? 1000),
  },
  ...tools.map(([id, label, t]): Command => ({ id, label, group: 'Tools', run: (a) => a.tool(t) })),
  ...Array.from(
    { length: 9 },
    (_, i): Command => ({ id: `angle${i + 1}`, label: `Cut to camera ${i + 1}`, group: 'Multicam', run: (a) => a.switchAngleNumber(i + 1) }),
  ),
  { id: 'addText', label: 'Add text', group: 'Project', run: (a) => a.addText(0) },
  { id: 'import', label: 'Import…', group: 'Project', run: (a) => a.importMedia() },
  { id: 'export', label: 'Export…', group: 'Project', run: (_a, ui) => ui.set({ dialog: 'export' }) },
  { id: 'renderQueue', label: 'Render queue', group: 'Project', run: () => panels.show({ kind: 'queue' }) },
  { id: 'undoHistory', label: 'Undo history', group: 'Project', run: () => panels.show({ kind: 'undo' }) },
  { id: 'collectFiles', label: 'Collect files / archive…', group: 'Project', run: () => panels.show({ kind: 'archive' }) },
  { id: 'shortcuts', label: 'Keyboard shortcuts…', group: 'Project', run: () => panels.show({ kind: 'shortcuts' }) },
  { id: 'pageEdit', label: 'Edit page', group: 'View', run: (_a, ui) => ui.set({ page: 'edit' }) },
  { id: 'pageColor', label: 'Color page', group: 'View', run: (_a, ui) => ui.set({ page: 'color' }) },
  { id: 'pageAudio', label: 'Audio page', group: 'View', run: (_a, ui) => ui.set({ page: 'audio' }) },
  { id: 'help', label: 'Keyboard help', group: 'View', run: (_a, ui) => ui.set({ dialog: 'help' }) },
];

export type Bindings = Record<string, string[]>;

const LUMORA: Bindings = {
  playPause: ['Space'],
  shuttleBack: ['J'],
  stop: ['K'],
  shuttleForward: ['L'],
  playInToOut: ['Ctrl+Shift+Space'],
  stepBack: ['Left'],
  stepForward: ['Right'],
  stepBack5: ['Shift+Left'],
  stepForward5: ['Shift+Right'],
  prevEdit: ['Up'],
  nextEdit: ['Down'],
  home: ['Home'],
  end: ['End'],
  goToIn: ['Shift+I'],
  goToOut: ['Shift+O'],
  nextMarker: ['Shift+M'],
  prevMarker: ['Ctrl+Shift+M'],
  markIn: ['I'],
  markOut: ['O'],
  markClip: ['X'],
  clearMarks: ['Ctrl+Shift+X'],
  marker: ['M'],
  undo: ['Ctrl+Z'],
  redo: ['Ctrl+Shift+Z', 'Ctrl+Y'],
  cut: ['Ctrl+X'],
  copy: ['Ctrl+C'],
  paste: ['Ctrl+V'],
  pasteInsert: ['Ctrl+Shift+V'],
  pasteAttributes: ['Ctrl+Alt+V'],
  selectAll: ['Ctrl+A'],
  deselect: ['Ctrl+Shift+A', 'Escape'],
  selectAtPlayhead: ['D'],
  clear: ['Delete', 'Backspace'],
  rippleDelete: ['Shift+Delete', 'Shift+Backspace'],
  addEdit: ['Ctrl+K'],
  addEditAll: ['Ctrl+Shift+K'],
  trimStart: ['Q'],
  trimEnd: ['W'],
  lift: [';'],
  extract: ["'"],
  insert: [','],
  overwrite: ['.'],
  nudgeLeft: ['Alt+Left'],
  nudgeRight: ['Alt+Right'],
  videoTransition: ['Ctrl+D'],
  audioTransition: ['Ctrl+Shift+D'],
  link: ['Ctrl+L'],
  toggleEnabled: ['Shift+E'],
  speed: ['Ctrl+R'],
  snapping: ['S'],
  zoomIn: ['=', 'Shift+=', 'NumAdd'],
  zoomOut: ['-', 'NumSub'],
  zoomFit: ['\\'],
  toolSelect: ['V'],
  toolRipple: ['B'],
  toolRoll: ['N'],
  toolRazor: ['C'],
  toolSlip: ['Y'],
  toolSlide: ['U'],
  toolHand: ['H'],
  toolText: ['T'],
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`angle${i + 1}`, [String(i + 1)]])),
  addText: ['Ctrl+T'],
  import: ['Ctrl+I'],
  export: ['Ctrl+M'],
  undoHistory: ['Ctrl+Alt+Z'],
  shortcuts: ['Ctrl+Alt+K'],
  pageEdit: ['Shift+1'],
  pageColor: ['Shift+2'],
  pageAudio: ['Shift+3'],
  help: ['F1'],
};

export const PRESETS: { id: string; name: string; bindings: Bindings }[] = [
  { id: 'lumora', name: 'Lumora Studio', bindings: LUMORA },
  { id: 'premiere', name: 'Premiere-like', bindings: { ...LUMORA, selectForward: ['A'] } },
  {
    id: 'resolve',
    name: 'Resolve-like',
    bindings: {
      ...LUMORA,
      toolSelect: ['A'],
      toolRazor: ['B'],
      toolRipple: ['T'],
      toolRoll: [],
      toolSlip: [],
      toolSlide: [],
      toolText: [],
      snapping: ['N'],
      addEdit: ['Ctrl+B', 'Ctrl+\\'],
      addEditAll: ['Ctrl+Shift+B'],
      videoTransition: ['Ctrl+T'],
      audioTransition: ['Alt+T'],
      addText: [],
      clear: ['Backspace'],
      rippleDelete: ['Delete', 'Shift+Backspace'],
      trimStart: ['Shift+['],
      trimEnd: ['Shift+]'],
      insert: ['F9'],
      overwrite: ['F10'],
      nudgeLeft: [',', 'Alt+Left'],
      nudgeRight: ['.', 'Alt+Right'],
      zoomIn: ['Ctrl+='],
      zoomOut: ['Ctrl+-'],
      zoomFit: ['Shift+Z'],
      prevMarker: ['Shift+Up'],
      nextMarker: ['Shift+Down'],
      link: ['Ctrl+Alt+L'],
      speed: ['R'],
      export: ['Ctrl+Shift+E'],
      toggleEnabled: ['D'],
      selectAtPlayhead: [],
    },
  },
  {
    id: 'finalcut',
    name: 'Final Cut-like',
    bindings: {
      ...LUMORA,
      toolSelect: ['A'],
      toolRazor: ['B'],
      toolRipple: ['T'],
      toolRoll: [],
      toolSlip: [],
      toolSlide: [],
      toolText: [],
      snapping: ['N'],
      addEdit: ['Ctrl+B'],
      addEditAll: ['Ctrl+Shift+B'],
      videoTransition: ['Ctrl+T'],
      audioTransition: [],
      addText: ['Alt+T'],
      trimStart: ['Alt+['],
      trimEnd: ['Alt+]'],
      rippleDelete: ['Delete', 'Backspace'],
      clear: ['Shift+Delete', 'Shift+Backspace'],
      insert: ['W'],
      overwrite: ['D'],
      selectAtPlayhead: [],
      toggleEnabled: ['V'],
      nextMarker: ["Ctrl+'"],
      prevMarker: ['Ctrl+;'],
      lift: [],
      extract: [],
      zoomIn: ['Ctrl+='],
      zoomOut: ['Ctrl+-'],
      zoomFit: ['Shift+Z'],
      export: ['Ctrl+E'],
    },
  },
];

const CODES: Record<string, string> = {
  Space: 'Space',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Equal: '=',
  Minus: '-',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: 'NumAdd',
  NumpadSubtract: 'NumSub',
  NumpadEnter: 'Enter',
};
const NAMED = ['Delete', 'Backspace', 'Escape', 'Home', 'End', 'Enter', 'Tab', 'PageUp', 'PageDown', 'Insert'];

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The key pressed, by its place on the keyboard (null for a modifier alone). */
export function keyName(e: Pick<KeyLike, 'key' | 'code'>): string | null {
  const code = e.code ?? '';
  if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'].includes(e.key)) return null;
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1] as string;
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1] as string;
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `Num${m[1]}`;
  if (CODES[code]) return CODES[code] as string;
  if (/^F\d{1,2}$/.test(code)) return code;
  if (NAMED.includes(code)) return code;
  // No place given (or an unusual key): the character.
  const k = e.key;
  if (k === ' ') return 'Space';
  if (k.startsWith('Arrow')) return k.slice(5);
  if (NAMED.includes(k) || /^F\d{1,2}$/.test(k)) return k;
  return k.length === 1 ? k.toUpperCase() : null;
}

/** A key press as text (“Ctrl+Shift+K”); the Mac's Command counts as Ctrl. */
export function comboOf(e: KeyLike): string | null {
  const k = keyName(e);
  if (!k) return null;
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', k].filter(Boolean).join('+');
}

/** Keys pressed with the same key in a different order of modifiers are the same keys. */
export function normalize(combo: string): string {
  const parts = combo.split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((x) => x.toLowerCase()));
  return [
    mods.has('ctrl') || mods.has('cmd') ? 'Ctrl' : '',
    mods.has('alt') || mods.has('option') ? 'Alt' : '',
    mods.has('shift') ? 'Shift' : '',
    key.length === 1 ? key.toUpperCase() : key,
  ]
    .filter(Boolean)
    .join('+');
}

/** Keys given to more than one command: key → the commands. */
export function conflicts(b: Bindings): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const [cmd, keys] of Object.entries(b)) for (const k of keys) by.set(normalize(k), [...(by.get(normalize(k)) ?? []), cmd]);
  return new Map([...by].filter(([, cmds]) => cmds.length > 1));
}

/** The command that already has these keys (other than `except`). */
export function holderOf(b: Bindings, combo: string, except?: string): string | null {
  const n = normalize(combo);
  for (const [cmd, keys] of Object.entries(b)) if (cmd !== except && keys.some((k) => normalize(k) === n)) return cmd;
  return null;
}

/** Give a command keys; with `steal`, they are taken from any command that had them. */
export function assign(b: Bindings, cmd: string, combo: string, steal = true): Bindings {
  const n = normalize(combo);
  const out: Bindings = {};
  for (const [c, keys] of Object.entries(b)) out[c] = steal && c !== cmd ? keys.filter((k) => normalize(k) !== n) : [...keys];
  const mine = out[cmd] ?? [];
  if (!mine.some((k) => normalize(k) === n)) out[cmd] = [...mine, n];
  return out;
}

export function unassign(b: Bindings, cmd: string, combo: string): Bindings {
  const n = normalize(combo);
  return { ...b, [cmd]: (b[cmd] ?? []).filter((k) => normalize(k) !== n) };
}

/** A preset's keys with this computer's changes on top. */
export function effective(preset: string, custom: Bindings): Bindings {
  const base = PRESETS.find((p) => p.id === preset)?.bindings ?? LUMORA;
  return { ...base, ...custom };
}

/** The changes from a preset (what is kept). */
export function diff(preset: string, b: Bindings): Bindings {
  const base = PRESETS.find((p) => p.id === preset)?.bindings ?? LUMORA;
  const out: Bindings = {};
  for (const [cmd, keys] of Object.entries(b)) {
    const was = (base[cmd] ?? []).map(normalize).sort().join(' ');
    if (keys.map(normalize).sort().join(' ') !== was) out[cmd] = keys;
  }
  return out;
}

/** Key → command, for looking up presses. */
export function lookup(b: Bindings): Map<string, string> {
  const m = new Map<string, string>();
  for (const [cmd, keys] of Object.entries(b)) for (const k of keys) if (!m.has(normalize(k))) m.set(normalize(k), cmd);
  return m;
}

const KEY = 'lumora-edit-keys';

interface Saved {
  preset: string;
  custom: Bindings;
}

class Keys {
  state: { preset: string; custom: Bindings; bindings: Bindings };
  private map: Map<string, string>;
  /** Every key the built-in Lumora Studio set uses (handled here, not by older key handling). */
  private known = lookup(LUMORA);
  private listeners = new Set<() => void>();

  constructor() {
    let s: Saved = { preset: 'lumora', custom: {} };
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
      if (v && typeof v.preset === 'string' && v.custom && typeof v.custom === 'object') s = v;
    } catch {
      // The built-in keys.
    }
    const bindings = effective(s.preset, s.custom);
    this.state = { preset: s.preset, custom: s.custom, bindings };
    this.map = lookup(bindings);
  }

  subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };

  private set(preset: string, custom: Bindings) {
    const bindings = effective(preset, custom);
    this.state = { preset, custom, bindings };
    this.map = lookup(bindings);
    try {
      localStorage.setItem(KEY, JSON.stringify({ preset, custom }));
    } catch {
      // Not kept: fine.
    }
    for (const f of this.listeners) f();
  }

  usePreset(preset: string) {
    this.set(preset, {});
  }

  setBindings(b: Bindings) {
    this.set(this.state.preset, diff(this.state.preset, b));
  }

  /** The command for a key press, or null. */
  commandFor(e: KeyLike): Command | null {
    const c = comboOf(e);
    const id = c ? this.map.get(normalize(c)) : undefined;
    return (id && COMMANDS.find((x) => x.id === id)) || null;
  }

  /** Keys the built-in set knows: never passed on to older key handling (even when unassigned here). */
  claims(e: KeyLike): boolean {
    const c = comboOf(e);
    return !!c && this.known.has(normalize(c));
  }

  /** The keys shown for a command in menus (the first of them). */
  keysFor(cmd: string): string | undefined {
    return this.state.bindings[cmd]?.[0];
  }
}

export const keys = new Keys();

export function useKeys() {
  return useSyncExternalStore(keys.subscribe, () => keys.state);
}

/** What a key press does (null: nothing here, and older key handling may look at it). */
export function shortcutFor(e: KeyLike, a: Actions, ui: Ui): (() => void) | 'claimed' | null {
  const cmd = keys.commandFor(e);
  if (cmd) return () => cmd.run(a, ui);
  return keys.claims(e) ? 'claimed' : null;
}
