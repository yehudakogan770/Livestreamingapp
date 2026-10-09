// The designer's state: the project being edited, what is selected, the
// playhead, and undo/redo. A small external store React reads with
// useSyncExternalStore; every change to the project goes through `edit`, which
// keeps the step for undo (a drag is one step: begin … edit … end).

import { followMain } from '../core/formats';
import { useSyncExternalStore } from 'react';
import type { BrandTokens, Layer, TitleProject, Values } from '../core/types';
import { compOf } from './ops';

export type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'pen' | 'hand' | 'note';

export interface KeyRef {
  layer: string;
  path: string;
  t: number;
}

export interface EditorState {
  project: TitleProject;
  compId: string;
  /** Selected layers (ids), the first is the main one. */
  selection: string[];
  keys: KeyRef[];
  /** The property shown in the graph editor. */
  graphProp: { layer: string; path: string } | null;
  time: number;
  playing: boolean;
  /** Play speed (J/K/L: negative plays backwards). */
  rate: number;
  /** "Take" preview: IN/HOLD/OUT as on air (seconds since take, since out). */
  cue: { inAt: number; outAt: number | null } | null;
  tool: Tool;
  /** Pixels per composition pixel; 0 = fit. */
  zoom: number;
  pan: [number, number];
  show: { safe: boolean; guides: boolean; grid: boolean; rulers: boolean; snap: boolean; motionPaths: boolean; notes: boolean };
  /** The note being written (its id). */
  editingNote?: string | null;
  /** Layers whose properties are open in the timeline (U: only animated ones). */
  open: Record<string, 'all' | 'animated'>;
  /** Sample values for previewing fields. */
  values: Values;
  /** The event look to preview with. */
  brand: Partial<BrandTokens> | null;
  /** Saved since the last change. */
  dirty: boolean;
  /** Where it was opened from / saved to. */
  path: string | null;
  /** A short message at the bottom ("Saved", "Copied 2 layers"). */
  status: string;
  /** Pixels per second in the timeline. */
  timelineZoom: number;
  /** The text layer being typed into on the canvas. */
  editingText: string | null;
}

const LIMIT = 200;

export class Store {
  private state: EditorState;
  private listeners = new Set<() => void>();
  private past: { project: TitleProject; label: string; selection: string[] }[] = [];
  private future: { project: TitleProject; label: string; selection: string[] }[] = [];
  private gesture: { project: TitleProject; label: string } | null = null;
  /** Bumped on every project change (caches, autosave). */
  version = 0;

  constructor(project: TitleProject, extra: Partial<EditorState> = {}) {
    this.state = {
      project,
      compId: project.main,
      selection: [],
      keys: [],
      graphProp: null,
      time: compOf(project, project.main).markers.inEnd,
      playing: false,
      rate: 1,
      cue: null,
      tool: 'select',
      zoom: 0,
      pan: [0, 0],
      show: { safe: true, guides: true, grid: false, rulers: true, snap: true, motionPaths: true, notes: true },
      open: {},
      values: {},
      brand: null,
      dirty: false,
      path: null,
      status: '',
      timelineZoom: 120,
      editingText: null,
      ...extra,
    };
  }

  get = () => this.state;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** Change what is shown (not the project: no undo step). */
  set(patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.emit();
  }

  /** Change the project (one undo step, or part of the current gesture). */
  edit(label: string, fn: (p: TitleProject) => TitleProject, extra: Partial<EditorState> = {}) {
    const before = this.state.project;
    // Formats follow the main composition's changes (core/formats.ts).
    const next = followMain(before, fn(before));
    if (next === before && !Object.keys(extra).length) return;
    if (next !== before) {
      if (!this.gesture) {
        this.past.push({ project: before, label, selection: this.state.selection });
        if (this.past.length > LIMIT) this.past.shift();
        this.future = [];
      }
      this.version++;
    }
    this.state = { ...this.state, ...extra, project: next, dirty: next !== before ? true : this.state.dirty };
    this.emit();
  }

  /** Start a drag: the edits until `end` are one undo step. */
  begin(label: string) {
    if (this.gesture) return;
    this.gesture = { project: this.state.project, label };
  }

  end() {
    const g = this.gesture;
    this.gesture = null;
    if (g && g.project !== this.state.project) {
      this.past.push({ project: g.project, label: g.label, selection: this.state.selection });
      if (this.past.length > LIMIT) this.past.shift();
      this.future = [];
    }
  }

  canUndo = () => this.past.length > 0;
  canRedo = () => this.future.length > 0;
  undoLabel = () => this.past[this.past.length - 1]?.label ?? '';
  redoLabel = () => this.future[this.future.length - 1]?.label ?? '';

  undo() {
    const step = this.past.pop();
    if (!step) return;
    this.future.push({ project: this.state.project, label: step.label, selection: this.state.selection });
    this.version++;
    this.state = {
      ...this.state,
      project: step.project,
      selection: step.selection,
      dirty: true,
      status: `Undid ${step.label.toLowerCase()}`,
      compId: fixComp(step.project, this.state.compId),
    };
    this.emit();
  }

  redo() {
    const step = this.future.pop();
    if (!step) return;
    this.past.push({ project: this.state.project, label: step.label, selection: this.state.selection });
    this.version++;
    this.state = {
      ...this.state,
      project: step.project,
      selection: step.selection,
      dirty: true,
      status: `Redid ${step.label.toLowerCase()}`,
      compId: fixComp(step.project, this.state.compId),
    };
    this.emit();
  }

  /**
   * The undo history, oldest first: every step's name, and how many of them
   * are done (the rest were undone and can be redone).
   */
  history(): { labels: string[]; done: number } {
    return { labels: [...this.past.map((x) => x.label), ...[...this.future].reverse().map((x) => x.label)], done: this.past.length };
  }

  /** Go back or forward in the history to just after step `done` (0: before the first). */
  goTo(done: number) {
    const target = Math.max(0, Math.min(done, this.past.length + this.future.length));
    while (this.past.length > target) this.undo();
    while (this.past.length < target && this.future.length) this.redo();
  }

  /** Open another project (clears undo). */
  load(project: TitleProject, extra: Partial<EditorState> = {}) {
    this.past = [];
    this.future = [];
    this.gesture = null;
    this.version++;
    const comp = compOf(project, project.main);
    this.state = {
      ...this.state,
      project,
      compId: comp.id,
      selection: [],
      keys: [],
      graphProp: null,
      time: comp.markers.inEnd,
      cue: null,
      playing: false,
      dirty: false,
      path: null,
      editingText: null,
      ...extra,
    };
    this.emit();
  }

  /** The current composition. */
  comp() {
    return compOf(this.state.project, this.state.compId);
  }

  selected(): Layer[] {
    const c = this.comp();
    const all = new Map<string, Layer>();
    const walk = (ls: Layer[]) => ls.forEach((l) => (all.set(l.id, l), l.type === 'group' && walk(l.children)));
    walk(c.layers);
    return this.state.selection.map((id) => all.get(id)).filter((l): l is Layer => !!l);
  }
}

const fixComp = (p: TitleProject, id: string) => (p.compositions.some((c) => c.id === id) ? id : p.main);

export function useStore<T>(store: Store, pick: (s: EditorState) => T): T {
  return useSyncExternalStore(store.subscribe, () => pick(store.get()));
}
