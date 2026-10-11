// An open document: its layers, history, view, the layer being worked on and
// the live state of the tools. The app keeps one per tab.

import { History, stateOf, type DocState } from '../core/history';
import { allLayers, findLayer } from '../core/layers';
import type { TileSwap } from '../core/raster';
import type { Doc, Layer } from '../core/types';
import type { Overrides } from '../gpu/compositor';
import type { Compositor } from '../gpu/compositor';

export interface ViewState {
  /** Screen pixels (CSS) per document pixel. */
  zoom: number;
  /** Where the document's center is on the canvas element (CSS px). */
  cx: number;
  cy: number;
  /** Degrees. */
  rotation: number;
  flip: boolean;
}

let sid = 1;

export class Session {
  readonly id = `s${sid++}`;
  doc: Doc;
  history: History;
  /** The layer being worked on. */
  active: string | null;
  /** Layers selected in the Layers panel (the active one included). */
  selected: string[];
  view: ViewState = { zoom: 1, cx: 0, cy: 0, rotation: 0, flip: false };
  /** The view was fit to the window and should refit when the window resizes. */
  fitted = true;
  /** History step id saved last (unsaved changes when the current step differs). */
  savedStep: number | null = null;
  /** Desktop path or web file name it was saved to / opened from. */
  path: string | null = null;
  /** The web File System Access handle, when the browser has one. */
  handle: FileSystemFileHandle | null = null;
  overrides: Overrides = {};
  quickMask = false;
  /** Painting goes into the active layer's mask. */
  editMask = false;
  /** Show the active layer's mask (or an alpha channel) on its own. */
  showMask: string | null = null;
  compositor: Compositor | null = null;
  /** Bumped to redraw the canvas. */
  frame = 0;
  /** Something changed (unsaved). */
  changedAt = 0;

  constructor(doc: Doc) {
    this.doc = doc;
    this.history = new History(stateOf(doc));
    const top = doc.layers[doc.layers.length - 1];
    this.active = top?.id ?? null;
    this.selected = top ? [top.id] : [];
  }

  get unsaved(): boolean {
    const step = this.history.steps[this.history.index - 1];
    return (step?.id ?? null) !== this.savedStep;
  }

  markSaved(): void {
    this.savedStep = this.history.steps[this.history.index - 1]?.id ?? null;
  }

  activeLayer(): Layer | null {
    return this.active ? findLayer(this.doc.layers, this.active) : null;
  }

  /** Put a state from history back on the document. */
  restore(s: DocState): void {
    this.doc = { ...this.doc, ...s };
    const ids = new Set(allLayers(this.doc.layers).map((l) => l.id));
    if (this.active && !ids.has(this.active)) {
      const top = this.doc.layers[this.doc.layers.length - 1];
      this.active = top?.id ?? null;
    }
    this.selected = this.selected.filter((i) => ids.has(i));
    if (this.active && !this.selected.includes(this.active)) this.selected = [this.active];
    if (this.editMask && !this.activeLayer()?.mask) this.editMask = false;
  }

  /** Record a change: `next` is the document after it; tile swaps were made already. */
  commit(label: string, icon: string, next: Doc, swaps: TileSwap[] = []): void {
    const before = stateOf(this.doc);
    this.doc = next;
    this.history.push(label, icon, before, stateOf(next), swaps);
    this.changedAt = Date.now();
  }

  /** Fold a change into the last history step (keeps one step for a run of nudges or typing). */
  amend(next: Doc, swaps: TileSwap[] = []): void {
    this.doc = next;
    this.history.amend(stateOf(next), swaps);
    this.changedAt = Date.now();
  }
}
