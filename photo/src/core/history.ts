// History: every change is a step holding the document as it was and as it
// became (layer trees and settings by reference) plus the raster tiles it
// swapped. Undo and redo put those back; nothing is copied, so steps are
// small. Snapshots keep a whole state (with each raster's tile map) and can
// be returned to, and the History Brush paints from any snapshot or step.

import { applySwap, type Raster, type Tile, type TileSwap } from './raster';
import type { Doc } from './types';
import { allLayers, hasRaster } from './layers';

/** Everything about a document that a step can change. */
export type DocState = Omit<Doc, 'id' | 'file' | 'format'>;

export const stateOf = (d: Doc): DocState => {
  const { id: _id, file: _file, format: _format, ...rest } = d;
  return rest;
};

export interface HistoryStep {
  id: number;
  label: string;
  /** A tool or command kind (for the History panel's icon). */
  icon: string;
  before: DocState;
  after: DocState;
  swaps: TileSwap[];
  bytes: number;
  time: number;
}

export interface Snapshot {
  id: number;
  name: string;
  state: DocState;
  tiles: Map<Raster, Map<number, Tile>>;
  time: number;
  /** The history step it was taken at (−1: before any). */
  at: number;
}

/** Every raster a state uses (layers, masks, smart sources, selection, channels). */
export function rastersOf(s: DocState): Raster[] {
  const out = new Set<Raster>();
  for (const l of allLayers(s.layers)) {
    if (hasRaster(l)) out.add(l.raster);
    if (l.mask) out.add(l.mask.raster);
    if (l.kind === 'smart') {
      out.add(l.source.raster);
      if (l.filterMask) out.add(l.filterMask);
    }
  }
  if (s.selection) out.add(s.selection.mask);
  for (const c of s.channels) out.add(c.raster);
  return [...out];
}

function swapBytes(sw: TileSwap[]): number {
  let n = 0;
  for (const s of sw) for (const t of s.before.values()) if (t) n += t.data.byteLength;
  return n;
}

let ids = 1;

export class History {
  steps: HistoryStep[] = [];
  /** How many steps are applied (steps after it can be redone). */
  index = 0;
  snapshots: Snapshot[] = [];
  /** Most steps kept (older ones are let go). */
  limit: number;
  /** Bytes of tile data kept for undo before the oldest steps are let go. */
  budget: number;
  /** Steps dropped from the start (so snapshots' `at` stays meaningful). */
  dropped = 0;

  constructor(initial: DocState, limit = 1000, budget = 3 * 1024 * 1024 * 1024) {
    this.limit = limit;
    this.budget = budget;
    this.snapshots.push(this.capture(initial, 'Open', -1));
  }

  capture(state: DocState, name: string, at = this.index - 1 + this.dropped): Snapshot {
    const tiles = new Map<Raster, Map<number, Tile>>();
    for (const r of rastersOf(state)) tiles.set(r, new Map(r.tiles));
    return { id: ids++, name, state, tiles, time: Date.now(), at };
  }

  push(label: string, icon: string, before: DocState, after: DocState, swaps: TileSwap[] = []): HistoryStep {
    // Redo steps are let go.
    this.steps.length = this.index;
    const step: HistoryStep = { id: ids++, label, icon, before, after, swaps, bytes: swapBytes(swaps), time: Date.now() };
    this.steps.push(step);
    this.index = this.steps.length;
    this.trim();
    return step;
  }

  /** Fold more tile changes into the last step (a tool that keeps working, like a text edit). */
  amend(after: DocState, swaps: TileSwap[] = []): void {
    const last = this.steps[this.index - 1];
    if (!last) return;
    last.after = after;
    last.swaps.push(...swaps);
    last.bytes += swapBytes(swaps);
  }

  private trim(): void {
    let total = this.steps.reduce((n, s) => n + s.bytes, 0);
    while (this.steps.length > 1 && (this.steps.length > this.limit || total > this.budget)) {
      const s = this.steps.shift()!;
      total -= s.bytes;
      this.index--;
      this.dropped++;
    }
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.steps.length;
  }

  /** Undo one step: returns the state to show. */
  undo(): DocState | null {
    if (!this.canUndo) return null;
    const s = this.steps[--this.index]!;
    for (let i = s.swaps.length - 1; i >= 0; i--) applySwap(s.swaps[i]!, 'before');
    return s.before;
  }

  redo(): DocState | null {
    if (!this.canRedo) return null;
    const s = this.steps[this.index++]!;
    for (const sw of s.swaps) applySwap(sw, 'after');
    return s.after;
  }

  /** Go to the state after `count` steps (the History panel's click). */
  goTo(count: number): DocState | null {
    let st: DocState | null = null;
    while (this.index > count) st = this.undo();
    while (this.index < count) st = this.redo();
    return st;
  }

  /** Take a snapshot of the current state. */
  snapshot(state: DocState, name?: string): Snapshot {
    const s = this.capture(state, name ?? `Snapshot ${this.snapshots.length}`);
    this.snapshots.push(s);
    return s;
  }

  /**
   * Return to a snapshot: recorded as a step (so it can be undone), with every
   * raster put back as it was.
   */
  restore(snap: Snapshot, current: DocState): DocState {
    const swaps: TileSwap[] = [];
    for (const [r, tiles] of snap.tiles) {
      const before = new Map<number, Tile | undefined>();
      const after = new Map<number, Tile | undefined>();
      for (const [k, t] of r.tiles) before.set(k, t);
      for (const k of before.keys()) if (!tiles.has(k)) after.set(k, undefined);
      for (const [k, t] of tiles) {
        after.set(k, t);
        if (!before.has(k)) before.set(k, undefined);
      }
      const sw = { raster: r, before, after };
      applySwap(sw, 'after');
      swaps.push(sw);
    }
    this.push(snap.name, 'snapshot', current, snap.state, swaps);
    return snap.state;
  }

  /**
   * A raster's tiles as they were after `count` steps (for the History Brush),
   * worked out by undoing the later steps' swaps on a copy of its tile map.
   */
  tilesAt(r: Raster, count: number): Map<number, Tile> {
    const map = new Map(r.tiles);
    for (let i = this.index - 1; i >= count; i--) {
      const s = this.steps[i]!;
      for (let j = s.swaps.length - 1; j >= 0; j--) {
        const sw = s.swaps[j]!;
        if (sw.raster !== r) continue;
        for (const [k, t] of sw.before) {
          if (t) map.set(k, t);
          else map.delete(k);
        }
      }
    }
    return map;
  }

  /** Bytes held for undo. */
  bytes(): number {
    return this.steps.reduce((n, s) => n + s.bytes, 0);
  }

  clear(state: DocState): void {
    this.steps = [];
    this.index = 0;
    this.dropped = 0;
    this.snapshots = [this.capture(state, 'Open', -1)];
  }
}
