import { useSyncExternalStore } from 'react';
import type { Project } from './model/project';

export type Selection = { kind: 'clip'; ids: string[] } | { kind: 'title'; id: string } | null;

export interface DocState {
  project: Project;
  selection: Selection;
  canUndo: boolean;
  canRedo: boolean;
  /** Changed since it was last saved. */
  dirty: boolean;
}

/**
 * The project being edited, with undo. Changes made one after another with
 * the same `key` (dragging a slider) are one step to undo.
 */
export class Doc {
  private past: Project[] = [];
  private future: Project[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;
  private listeners = new Set<() => void>();
  state: DocState;

  constructor(project: Project) {
    this.state = { project, selection: null, canUndo: false, canRedo: false, dirty: false };
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

  edit(f: (p: Project) => Project, key?: string) {
    const before = this.state.project;
    const after = f(before);
    if (after === before) return;
    const now = Date.now();
    const same = key !== undefined && key === this.lastKey && now - this.lastAt < 1500;
    if (!same) {
      this.past.push(before);
      if (this.past.length > 200) this.past.shift();
    }
    this.lastKey = key ?? null;
    this.lastAt = now;
    this.future = [];
    this.set({ project: after, dirty: true, selection: this.keep(this.state.selection, after) });
  }

  undo() {
    const p = this.past.pop();
    if (!p) return;
    this.future.push(this.state.project);
    this.lastKey = null;
    this.set({ project: p, dirty: true, selection: this.keep(this.state.selection, p) });
  }

  redo() {
    const p = this.future.pop();
    if (!p) return;
    this.past.push(this.state.project);
    this.lastKey = null;
    this.set({ project: p, dirty: true, selection: this.keep(this.state.selection, p) });
  }

  select(selection: Selection) {
    this.set({ selection });
  }

  saved() {
    this.set({ dirty: false });
  }

  /** What stays selected after a change (things that are gone aren't). */
  private keep(s: Selection, p: Project): Selection {
    if (!s) return null;
    if (s.kind === 'title') return p.titles.some((t) => t.id === s.id) ? s : null;
    const ids = s.ids.filter((id) => p.clips.some((c) => c.id === id));
    return ids.length ? { kind: 'clip', ids } : null;
  }
}

export function useDoc(doc: Doc): DocState {
  return useSyncExternalStore(doc.subscribe, () => doc.state);
}
