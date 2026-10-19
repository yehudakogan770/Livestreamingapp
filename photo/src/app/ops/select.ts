// The Select menu: select all, deselect, inverse, modify, grow, similar,
// saving and loading selections as channels, quick mask.

import { bump, current, toast } from '../state';
import { change, selectionMask, withSelection, flatten, canvasRect } from './common';
import {
  allMask,
  borderMask,
  combine,
  featherMask,
  growMask,
  invertMask,
  growByColor,
  smoothMask,
  maskToRaster,
  rasterToMask,
  colorRange,
  type Mask,
  type SelectOp,
  type ColorRangeMode,
  transformMask,
} from '../../core/selection';
import { uid } from '../../core/layers';
import type { Doc } from '../../core/types';

let lastSelection: Mask | null = null;

/** Make a new selection, combining with the current one. */
export function applySelection(m: Mask, op: SelectOp, label = 'Selection', feather = 0): void {
  const s = current();
  if (!s) return;
  let next = feather > 0 ? featherMask(m, feather) : m;
  const cur = selectionMask(s.doc);
  if (op !== 'replace' && cur) next = combine(cur, next, op);
  else if (op === 'subtract' || op === 'intersect') {
    if (op === 'intersect') next = m;
    else return;
  }
  change(label, 'select', (d) => withSelection(d, next));
}

export function selectAll(): void {
  const s = current();
  if (!s) return;
  applySelection(allMask(s.doc.width, s.doc.height), 'replace', 'Select All');
}

export function deselect(): void {
  const s = current();
  if (!s || !s.doc.selection) return;
  lastSelection = selectionMask(s.doc);
  change('Deselect', 'select', (d) => withSelection(d, null));
}

export function reselect(): void {
  const s = current();
  if (!s || !lastSelection || lastSelection.w !== s.doc.width || lastSelection.h !== s.doc.height) return;
  const m = lastSelection;
  change('Reselect', 'select', (d) => withSelection(d, m));
}

export function inverse(): void {
  const s = current();
  if (!s) return;
  const cur = selectionMask(s.doc) ?? { w: s.doc.width, h: s.doc.height, data: new Uint8Array(s.doc.width * s.doc.height) };
  change('Select Inverse', 'select', (d) => withSelection(d, invertMask(cur)));
}

export function modify(kind: 'border' | 'smooth' | 'expand' | 'contract' | 'feather', amount: number): void {
  const s = current();
  const cur = s ? selectionMask(s.doc) : null;
  if (!s || !cur) {
    toast('Make a selection first.');
    return;
  }
  const m =
    kind === 'border'
      ? borderMask(cur, amount)
      : kind === 'smooth'
        ? smoothMask(cur, amount)
        : kind === 'expand'
          ? growMask(cur, amount)
          : kind === 'contract'
            ? growMask(cur, -amount)
            : featherMask(cur, amount);
  const label = { border: 'Border', smooth: 'Smooth', expand: 'Expand', contract: 'Contract', feather: 'Feather' }[kind];
  change(label, 'select', (d) => withSelection(d, m));
}

/** Grow: neighbors of a similar color (the Magic Wand's tolerance); Similar: anywhere. */
export function growSimilar(tolerance: number, anywhere: boolean): void {
  const s = current();
  const cur = s ? selectionMask(s.doc) : null;
  if (!s || !cur) return;
  const px = flatten(s.doc, canvasRect(s.doc));
  const m = growByColor({ w: s.doc.width, h: s.doc.height, data: px }, cur, tolerance, !anywhere);
  change(anywhere ? 'Similar' : 'Grow', 'select', (d) => withSelection(d, m));
}

export function colorRangeSelect(mode: ColorRangeMode, samples: [number, number, number][], fuzziness: number, op: SelectOp = 'replace'): void {
  const s = current();
  if (!s) return;
  const px = flatten(s.doc, canvasRect(s.doc));
  const m = colorRange({ w: s.doc.width, h: s.doc.height, data: px }, mode, samples, fuzziness);
  applySelection(m, op, 'Color Range');
}

/** Save the selection as an alpha channel. */
export function saveSelection(name?: string): void {
  const s = current();
  const cur = s ? selectionMask(s.doc) : null;
  if (!s || !cur) return;
  const ch = {
    id: uid('c'),
    name: name ?? `Alpha ${s.doc.channels.length + 1}`,
    raster: maskToRaster(cur),
    visible: false,
    color: [1, 0, 0, 0.5] as [number, number, number, number],
  };
  change('Save Selection', 'channel', (d) => ({ ...d, channels: [...d.channels, ch] }));
}

export function loadSelection(channelId: string, op: SelectOp = 'replace', invert = false): void {
  const s = current();
  const ch = s?.doc.channels.find((c) => c.id === channelId);
  if (!s || !ch) return;
  let m = rasterToMask(ch.raster, s.doc.width, s.doc.height);
  if (invert) m = invertMask(m);
  applySelection(m, op, 'Load Selection');
}

export function deleteChannel(id: string): void {
  change('Delete Channel', 'channel', (d) => ({ ...d, channels: d.channels.filter((c) => c.id !== id) }));
}

export function toggleQuickMask(): void {
  const s = current();
  if (!s) return;
  s.quickMask = !s.quickMask;
  // Entering quick mask with no selection shows everything masked (nothing selected).
  bump();
}

/** Move or transform the selection outline only. */
export function transformSelection(mat: number[], label = 'Transform Selection'): void {
  const s = current();
  const cur = s ? selectionMask(s.doc) : null;
  if (!s || !cur) return;
  change(label, 'select', (d) => withSelection(d, transformMask(cur, mat)));
}

export function selectionFromDoc(d: Doc): Mask | null {
  return selectionMask(d);
}

export function hasSelection(): boolean {
  return !!current()?.doc.selection;
}

export { bump };
