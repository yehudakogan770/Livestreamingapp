import { useSyncExternalStore } from 'react';
import type { Project } from './model/types';

export type Selection = { kind: 'clips'; ids: string[] } | { kind: 'marker'; id: string } | { kind: 'transition'; clip: string; side: 'in' | 'out' } | null;

export interface DocState {
  project: Project;
  selection: Selection;
  canUndo: boolean;
  canRedo: boolean;
  /** Changed since it was last saved. */
  dirty: boolean;
  /** What the last change was (shown next to Undo). */
  last: string;
}

/**
 * The project being edited, with undo. Changes made one after another with
 * the same `key` (dragging a slider) are one step to undo.
 */
export class Doc {
  private past: { p: Project; label: string }[] = [];
  private future: { p: Project; label: string }[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;
  private listeners = new Set<() => void>();
  state: DocState;
  /**
   * For a shared project: may this change be made? Null when it may,
   * otherwise why not (it is then not made, and `blocked` is told).
   */
  gate: ((before: Project, after: Project) => string | null) | null = null;
  blocked: (why: string) => void = () => {};

  constructor(project: Project) {
    this.state = { project, selection: null, canUndo: false, canRedo: false, dirty: false, last: '' };
  }

  subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  private set(change: Partial<DocState>) {
    this.state = { ...this.state, ...change, canUndo: this.past.length > 0, canRedo: this.future.length > 0 };
    for (const f of this.listeners) f();
  }

  get project(): Project {
    return this.state.project;
  }

  edit(f: (p: Project) => Project, label = 'Edit', key?: string) {
    const before = this.state.project;
    const after = f(before);
    if (after === before || !this.allowed(before, after)) return;
    const now = Date.now();
    const same = key !== undefined && key === this.lastKey && now - this.lastAt < 1500;
    if (!same) {
      this.past.push({ p: before, label });
      if (this.past.length > 300) this.past.shift();
    }
    this.lastKey = key ?? null;
    this.lastAt = now;
    this.future = [];
    this.set({ project: after, dirty: true, last: label, selection: keep(this.state.selection, after) });
  }

  private allowed(before: Project, after: Project): boolean {
    const why = this.gate?.(before, after) ?? null;
    if (why) this.blocked(why);
    return !why;
  }

  undo() {
    const x = this.past[this.past.length - 1];
    if (!x || !this.allowed(this.state.project, x.p)) return;
    this.past.pop();
    this.future.push({ p: this.state.project, label: x.label });
    this.lastKey = null;
    this.set({ project: x.p, dirty: true, last: x.label, selection: keep(this.state.selection, x.p) });
  }

  redo() {
    const x = this.future[this.future.length - 1];
    if (!x || !this.allowed(this.state.project, x.p)) return;
    this.future.pop();
    this.past.push({ p: this.state.project, label: x.label });
    this.lastKey = null;
    this.set({ project: x.p, dirty: true, last: x.label, selection: keep(this.state.selection, x.p) });
  }

  /** What Undo would take back. */
  get undoLabel(): string {
    return this.past[this.past.length - 1]?.label ?? '';
  }
  get redoLabel(): string {
    return this.future[this.future.length - 1]?.label ?? '';
  }

  select(selection: Selection) {
    this.set({ selection });
  }

  /** Change without a step to undo (e.g. where the playhead is). */
  quiet(f: (p: Project) => Project) {
    const after = f(this.state.project);
    if (after !== this.state.project) this.set({ project: after });
  }

  saved() {
    this.set({ dirty: false });
  }

  /**
   * Bring in a change made elsewhere (someone else's save): into what is
   * shown and into every undo step, so Undo never takes their work back.
   */
  rebase(f: (p: Project) => Project, dirty = false) {
    this.past = this.past.map((x) => ({ ...x, p: f(x.p) }));
    this.future = this.future.map((x) => ({ ...x, p: f(x.p) }));
    const after = f(this.state.project);
    this.set({ project: after, selection: keep(this.state.selection, after), ...(dirty ? { dirty: true } : {}) });
  }

  /** Start over from another project (a reload or a restored version): nothing to undo. */
  replace(project: Project) {
    this.past = [];
    this.future = [];
    this.lastKey = null;
    this.set({ project, dirty: false, last: '', selection: keep(this.state.selection, project) });
  }
}

/** What stays selected after a change (things that are gone aren't). */
function keep(s: Selection, p: Project): Selection {
  if (!s) return null;
  const seq = p.sequences.find((x) => x.id === p.open);
  if (!seq) return null;
  if (s.kind === 'marker') return seq.markers.some((m) => m.id === s.id) ? s : null;
  if (s.kind === 'transition') {
    const c = seq.clips.find((x) => x.id === s.clip);
    return c && (s.side === 'in' ? c.tIn : c.tOut) ? s : null;
  }
  const ids = s.ids.filter((id) => seq.clips.some((c) => c.id === id));
  return ids.length ? { kind: 'clips', ids } : null;
}

export function useDoc(doc: Doc): DocState {
  return useSyncExternalStore(doc.subscribe, () => doc.state);
}

export const selectedIds = (s: Selection): string[] => (s?.kind === 'clips' ? s.ids : []);
