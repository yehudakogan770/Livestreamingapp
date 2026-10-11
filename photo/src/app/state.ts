// The app's state: open documents, the tool and its options, colors, the
// workspace, and what dialog or message is showing.

import { Store, useStore } from './store';
import { Session } from './session';
import { defaultOptions, TOOL_GROUPS, type ToolId, type ToolOptions } from './toolDefs';
import type { Doc } from '../core/types';

export type Theme = 'dark' | 'light';

export interface DialogSpec {
  kind: string;
  props?: Record<string, unknown>;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export interface Prefs {
  historyStates: number;
  /** Interface size (zoom of the whole UI). */
  uiScale: number;
  checkerSize: 'small' | 'medium' | 'large';
  units: 'px' | 'in' | 'cm' | 'mm' | 'pt' | '%';
  gridSpacing: number;
  gridSubdivisions: number;
  guideColor: string;
  showBrushCrosshair: boolean;
  cursor: 'normal' | 'precise';
  autosaveMinutes: number;
  /** Display color space (P3 screens show the document in P3). */
  displayP3: boolean;
  zoomWithWheel: boolean;
}

export interface AppState {
  sessions: Session[];
  current: string | null;
  tool: ToolId;
  /** The tool last picked in each toolbar group (by group index). */
  groupTool: Record<number, ToolId>;
  opts: ToolOptions;
  fg: [number, number, number];
  bg: [number, number, number];
  theme: Theme;
  dialog: DialogSpec | null;
  toasts: Toast[];
  /** Bumped whenever the current document or its history changes. */
  rev: number;
  showRulers: boolean;
  showGrid: boolean;
  showGuides: boolean;
  showExtras: boolean;
  snap: boolean;
  pixelGrid: boolean;
  screenMode: 'standard' | 'full';
  /** A long task running (shown over the window). */
  busy: { text: string; progress: number | null } | null;
  prefs: Prefs;
  /** Panels shown in the dock (see ui/dock.tsx for the layout). */
  layoutRev: number;
  /** A workspace that replaces the window (Select and Mask, Liquify, Camera Raw). */
  workspace: DialogSpec | null;
  /** Tool presets the person saved. */
  brushPresets: { name: string; tip: ToolOptions['brush']['tip'] }[];
  swatches: [number, number, number][];
  /** Recent colors used (Color panel). */
  recentColors: [number, number, number][];
}

const PREFS_KEY = 'lumora.photo.prefs';
const UI_KEY = 'lumora.photo.ui';

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

export const DEFAULT_PREFS: Prefs = {
  historyStates: 1000,
  uiScale: 1,
  checkerSize: 'medium',
  units: 'px',
  gridSpacing: 100,
  gridSubdivisions: 4,
  guideColor: '#3fb6d8',
  showBrushCrosshair: false,
  cursor: 'normal',
  autosaveMinutes: 5,
  displayP3: true,
  zoomWithWheel: false,
};

export const DEFAULT_SWATCHES: [number, number, number][] = [
  '#000000', '#ffffff', '#7f7f7f', '#c0c0c0', '#ed1c24', '#f26522', '#ffde17', '#8dc63f', '#00a651', '#00a99d', '#00aeef', '#0072bc', '#2e3192', '#662d91', '#92278f', '#ec008c',
  '#f7977a', '#fbad82', '#fff79a', '#c4df9b', '#82ca9c', '#7accc8', '#6dcff6', '#8393ca', '#a187be', '#f49ac1', '#603913', '#8c6239', '#a67c52', '#c69c6d', '#e6d5b8', '#1f2a36',
].map((h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255] as [number, number, number]);

const ui = loadJSON(UI_KEY, {
  theme: 'dark' as Theme,
  showRulers: true,
  showGrid: false,
  showGuides: true,
  snap: true,
  showExtras: true,
  swatches: DEFAULT_SWATCHES,
  brushPresets: [] as AppState['brushPresets'],
});

export const app = new Store<AppState>({
  sessions: [],
  current: null,
  tool: 'move',
  groupTool: {},
  opts: defaultOptions(),
  fg: [0, 0, 0],
  bg: [1, 1, 1],
  theme: ui.theme,
  dialog: null,
  toasts: [],
  rev: 0,
  showRulers: ui.showRulers,
  showGrid: ui.showGrid,
  showGuides: ui.showGuides,
  showExtras: ui.showExtras,
  snap: ui.snap,
  pixelGrid: true,
  screenMode: 'standard',
  busy: null,
  prefs: loadJSON(PREFS_KEY, DEFAULT_PREFS),
  layoutRev: 0,
  workspace: null,
  brushPresets: ui.brushPresets,
  swatches: ui.swatches,
  recentColors: [],
});

// Remember the workspace choices.
app.subscribe(() => {
  const s = app.get();
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ theme: s.theme, showRulers: s.showRulers, showGrid: s.showGrid, showGuides: s.showGuides, snap: s.snap, showExtras: s.showExtras, swatches: s.swatches, brushPresets: s.brushPresets }));
    localStorage.setItem(PREFS_KEY, JSON.stringify(s.prefs));
  } catch {
    /* storage full or blocked: settings stay for this visit */
  }
});

export const useApp = <S>(sel: (s: AppState) => S): S => useStore(app, sel);

export function current(): Session | null {
  const s = app.get();
  return s.sessions.find((x) => x.id === s.current) ?? null;
}

export function useSession(): Session | null {
  return useApp((s) => s.sessions.find((x) => x.id === s.current) ?? null);
}

/** Watch the current document (re-renders on every change to it). */
export function useDoc(): Doc | null {
  useApp((s) => s.rev);
  return current()?.doc ?? null;
}

let frameListeners = new Set<() => void>();

/** The canvas should be drawn again (no React re-render). */
export function requestFrame(): void {
  for (const f of frameListeners) f();
}

export function onFrameRequest(f: () => void): () => void {
  frameListeners.add(f);
  return () => {
    frameListeners.delete(f);
  };
}

/** The document changed: panels re-render, the canvas redraws. */
export function bump(): void {
  app.set((s) => ({ rev: s.rev + 1 }));
  requestFrame();
}

let toastId = 1;
export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const id = toastId++;
  app.set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
  setTimeout(() => app.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 3500);
}

export function openDialog(kind: string, props?: Record<string, unknown>): void {
  app.set({ dialog: { kind, props } });
}

export function closeDialog(): void {
  app.set({ dialog: null });
}

export function setTool(id: ToolId): void {
  const gi = TOOL_GROUPS.findIndex((g) => g.some((t) => t.id === id));
  app.set((s) => ({ tool: id, groupTool: { ...s.groupTool, [gi]: id } }));
  requestFrame();
}

export function setOpts<K extends keyof ToolOptions>(k: K, patch: Partial<ToolOptions[K]>): void {
  app.set((s) => ({ opts: { ...s.opts, [k]: { ...s.opts[k], ...patch } } }));
}

export function addSession(doc: Doc): Session {
  const s = new Session(doc);
  s.history.limit = app.get().prefs.historyStates;
  app.set((st) => ({ sessions: [...st.sessions, s], current: s.id, rev: st.rev + 1 }));
  return s;
}

export function setCurrent(id: string): void {
  app.set((s) => ({ current: id, rev: s.rev + 1 }));
  requestFrame();
}

export function removeSession(id: string): void {
  const s = app.get();
  const list = s.sessions.filter((x) => x.id !== id);
  const gone = s.sessions.find((x) => x.id === id);
  gone?.compositor?.dispose();
  const idx = s.sessions.findIndex((x) => x.id === id);
  const next = s.current === id ? (list[Math.min(idx, list.length - 1)]?.id ?? null) : s.current;
  app.set({ sessions: list, current: next, rev: s.rev + 1 });
}

/** Run a slow task with the busy overlay. */
export async function busy<T>(text: string, f: (progress: (p: number) => void) => Promise<T>): Promise<T> {
  app.set({ busy: { text, progress: null } });
  // Let the overlay paint first.
  await new Promise((r) => setTimeout(r, 30));
  try {
    return await f((p) => app.set({ busy: { text, progress: p } }));
  } finally {
    app.set({ busy: null });
  }
}

export function pushRecentColor(c: [number, number, number]): void {
  app.set((s) => ({ recentColors: [c, ...s.recentColors.filter((x) => x.some((v, i) => Math.abs(v - c[i]!) > 1e-3))].slice(0, 12) }));
}
