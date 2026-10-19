// The Type tool: click for point text, drag for paragraph text in a box,
// click a path for text on the path, click text to edit it. Typing goes
// through a hidden text field (so input methods, paste and the arrow keys
// all work); the layer is drawn again as you type, and the whole edit is one
// history step.

import { app, current, requestFrame, bump } from '../state';
import { newText, setPlainText, styleRange, plainText, type CharStyle, type TextModel, type ParaStyle } from '../../core/text';
import { baseLayer, findLayer, insertLayers, updateLayer, removeLayers, allLayers } from '../../core/layers';
import { Raster } from '../../core/raster';
import { renderTextRaster } from '../layerContent';
import { caretAt, indexAt, drawnBounds } from '../textRender';
import { stateOf } from '../../core/history';
import { flatten as flattenPath } from '../../core/path';
import type { Doc, TextLayer } from '../../core/types';
import type { Overlay, Tool } from './types';
import { viewport, toScreen } from './types';
import { targetPath } from './vectorTools';

interface Editing {
  layerId: string;
  isNew: boolean;
  before: ReturnType<typeof stateOf>;
  input: HTMLTextAreaElement;
  start: number;
  end: number;
}

let edit: Editing | null = null;
let boxDrag: { x0: number; y0: number; x1: number; y1: number } | null = null;

export const isEditingText = () => !!edit;

function layerOf(): TextLayer | null {
  const s = current();
  if (!s || !edit) return null;
  const l = findLayer(s.doc.layers, edit.layerId);
  return l?.kind === 'text' ? l : null;
}

function setText(t: TextModel): void {
  const s = current();
  const l = layerOf();
  if (!s || !l) return;
  const name = plainText(t).trim().slice(0, 40) || 'Text';
  const next: TextLayer = { ...l, text: t, name, raster: renderTextRaster({ ...l, text: t }, s.doc) };
  s.doc = { ...s.doc, layers: updateLayer(s.doc.layers, l.id, () => next) };
  requestFrame();
  bump();
}

function makeInput(): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  ta.setAttribute('aria-label', 'Text');
  ta.spellcheck = false;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px;opacity:0;';
  document.body.appendChild(ta);
  ta.addEventListener('input', () => {
    const l = layerOf();
    if (!l || !edit) return;
    const old = plainText(l.text);
    const now = ta.value;
    // Apply the change as a splice that keeps the styles of untouched characters.
    let a = 0;
    while (a < old.length && a < now.length && old[a] === now[a]) a++;
    let b = 0;
    while (b < old.length - a && b < now.length - a && old[old.length - 1 - b] === now[now.length - 1 - b]) b++;
    const inserted = now.slice(a, now.length - b);
    const runs = spliceRuns(l.text, a, old.length - b, inserted);
    edit.start = ta.selectionStart;
    edit.end = ta.selectionEnd;
    setText({ ...l.text, runs });
  });
  const sync = () => {
    if (!edit) return;
    edit.start = ta.selectionStart;
    edit.end = ta.selectionEnd;
    requestFrame();
  };
  ta.addEventListener('select', sync);
  ta.addEventListener('keyup', sync);
  ta.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || e.key === 'Escape') {
      e.preventDefault();
      commitText();
    }
    e.stopPropagation();
  });
  return ta;
}

function spliceRuns(t: TextModel, from: number, to: number, insert: string): TextModel['runs'] {
  const runs = t.runs.map((r) => ({ ...r }));
  // Remove [from, to).
  let at = 0;
  const out: TextModel['runs'] = [];
  let styleAtFrom: TextModel['runs'][number]['style'] = runs[0]?.style;
  for (const r of runs) {
    const a = at,
      b = at + r.text.length;
    at = b;
    if (from > a && from <= b) styleAtFrom = r.style;
    else if (from === 0 && a === 0) styleAtFrom = r.style;
    const keepA = r.text.slice(0, Math.max(0, Math.min(r.text.length, from - a)));
    const keepB = r.text.slice(Math.max(0, Math.min(r.text.length, to - a)));
    const kept = from >= b || to <= a ? r.text : keepA + keepB;
    if (kept) out.push({ text: kept, style: r.style });
  }
  // Insert at `from` with the style there.
  if (insert) {
    let pos = 0;
    let done = false;
    const res: TextModel['runs'] = [];
    for (const r of out) {
      if (!done && from <= pos + r.text.length) {
        const k = from - pos;
        if (JSON.stringify(r.style ?? {}) === JSON.stringify(styleAtFrom ?? {}))
          res.push({ text: r.text.slice(0, k) + insert + r.text.slice(k), style: r.style });
        else {
          if (k > 0) res.push({ text: r.text.slice(0, k), style: r.style });
          res.push({ text: insert, style: styleAtFrom });
          if (k < r.text.length) res.push({ text: r.text.slice(k), style: r.style });
        }
        done = true;
      } else res.push(r);
      pos += r.text.length;
    }
    if (!done) res.push({ text: insert, style: styleAtFrom });
    return res.filter((r) => r.text);
  }
  return out.length ? out : [{ text: '', style: styleAtFrom }];
}

function startEditing(layer: TextLayer, isNew: boolean, caret: number, before: Doc): void {
  const s = current()!;
  s.active = layer.id;
  s.selected = [layer.id];
  const input = makeInput();
  input.value = plainText(layer.text);
  edit = { layerId: layer.id, isNew, before: stateOf(before), input, start: caret, end: caret };
  input.focus();
  input.setSelectionRange(caret, caret);
  bump();
}

export function commitText(): void {
  const s = current();
  const e = edit;
  if (!e) return;
  edit = null;
  e.input.remove();
  if (!s) return;
  const l = findLayer(s.doc.layers, e.layerId);
  if (l?.kind === 'text' && !plainText(l.text).trim()) {
    // Empty text: no layer.
    s.doc = { ...s.doc, layers: removeLayers(s.doc.layers, new Set([l.id])) };
    if (!e.isNew) s.history.push('Delete Text', 'type', e.before, stateOf(s.doc));
    const top = allLayers(s.doc.layers).pop();
    s.active = top?.id ?? null;
    s.selected = top ? [top.id] : [];
    bump();
    return;
  }
  s.history.push(e.isNew ? 'Type Tool' : 'Edit Type Layer', 'type', e.before, stateOf(s.doc));
  s.changedAt = Date.now();
  bump();
}

/** Apply character settings to the selected characters (while typing) or the whole layer. */
export function applyCharStyle(patch: Partial<CharStyle>): void {
  const s = current();
  if (!s) return;
  if (edit) {
    const l = layerOf();
    if (!l) return;
    const [a, b] = [Math.min(edit.start, edit.end), Math.max(edit.start, edit.end)];
    if (a === b) {
      // No selection: future typing and the whole layer's base.
      setText({ ...l.text, base: { ...l.text.base, ...patch }, runs: l.text.runs.map((r) => (r.style ? { ...r, style: { ...r.style, ...patch } } : r)) });
    } else setText(styleRange(l.text, a, b, patch));
    edit.input.focus();
    return;
  }
  const l = s.activeLayer();
  if (l?.kind !== 'text') return;
  const t = { ...l.text, base: { ...l.text.base, ...patch }, runs: l.text.runs.map((r) => (r.style ? { ...r, style: { ...r.style, ...patch } } : r)) };
  s.commit('Character', 'type', {
    ...s.doc,
    layers: updateLayer(s.doc.layers, l.id, () => ({ ...l, text: t, raster: renderTextRaster({ ...l, text: t }, s.doc) })),
  });
  bump();
}

export function applyParaStyle(patch: Partial<ParaStyle>): void {
  const s = current();
  const l = edit ? layerOf() : s?.activeLayer();
  if (!s || !l || l.kind !== 'text') return;
  const t = { ...l.text, para: { ...l.text.para, ...patch } };
  if (edit) {
    setText(t);
    edit.input.focus();
    return;
  }
  s.commit('Paragraph', 'type', {
    ...s.doc,
    layers: updateLayer(s.doc.layers, l.id, () => ({ ...l, text: t, raster: renderTextRaster({ ...l, text: t }, s.doc) })),
  });
  bump();
}

export function setTextModel(id: string, t: TextModel, label = 'Edit Type Layer'): void {
  const s = current();
  const l = s ? findLayer(s.doc.layers, id) : null;
  if (!s || l?.kind !== 'text') return;
  s.commit(label, 'type', { ...s.doc, layers: updateLayer(s.doc.layers, id, () => ({ ...l, text: t, raster: renderTextRaster({ ...l, text: t }, s.doc) })) });
  bump();
}

function textLayerAt(x: number, y: number): TextLayer | null {
  const s = current();
  if (!s) return null;
  for (const l of allLayers(s.doc.layers).reverse()) {
    if (l.kind !== 'text' || !l.visible) continue;
    const b = drawnBounds(l.text);
    if (x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h) return l;
  }
  return null;
}

export const typeTool: Tool = {
  id: 'type',
  cursor: () => 'text',
  down: (e) => {
    const s = current();
    if (!s) return;
    if (edit) {
      const l = layerOf();
      if (l) {
        const b = drawnBounds(l.text);
        if (e.x >= b.x && e.y >= b.y && e.x <= b.x + b.w && e.y <= b.y + b.h) {
          const i = indexAt(l.text, e.x, e.y);
          edit.input.setSelectionRange(i, i);
          edit.start = edit.end = i;
          edit.input.focus();
          requestFrame();
          return;
        }
      }
      commitText();
    }
    const hit = textLayerAt(e.x, e.y);
    if (hit) {
      startEditing(hit, false, indexAt(hit.text, e.x, e.y), s.doc);
      return;
    }
    boxDrag = { x0: e.x, y0: e.y, x1: e.x, y1: e.y };
  },
  move: (e) => {
    if (!boxDrag) return;
    boxDrag.x1 = e.x;
    boxDrag.y1 = e.y;
    requestFrame();
  },
  up: () => {
    const s = current();
    const d = boxDrag;
    boxDrag = null;
    if (!s || !d) return;
    const o = app.get().opts.type;
    const style: Partial<CharStyle> = {
      family: o.family,
      weight: o.weight,
      italic: o.italic,
      size: o.size,
      color: [...app.get().fg] as [number, number, number],
    };
    const w = Math.abs(d.x1 - d.x0),
      h = Math.abs(d.y1 - d.y0);
    let t: TextModel;
    // On a path: text along it.
    const p = targetPath();
    const onPath = (() => {
      if (!p || w > 4) return null;
      const poly = flattenPath(p, 1)[0]?.pts ?? [];
      let best = Infinity,
        acc = 0,
        at = 0;
      for (let i = 0; i + 3 < poly.length; i += 2) {
        const x0 = poly[i]!,
          y0 = poly[i + 1]!,
          x1 = poly[i + 2]!,
          y1 = poly[i + 3]!;
        const len = Math.hypot(x1 - x0, y1 - y0);
        const tt = Math.max(0, Math.min(1, ((d.x0 - x0) * (x1 - x0) + (d.y0 - y0) * (y1 - y0)) / (len * len || 1)));
        const dist = Math.hypot(x0 + (x1 - x0) * tt - d.x0, y0 + (y1 - y0) * tt - d.y0);
        if (dist < best) {
          best = dist;
          at = acc + tt * len;
        }
        acc += len;
      }
      return best < 8 / s.view.zoom ? at : null;
    })();
    if (onPath !== null && p) {
      t = { ...newText(d.x0, d.y0, '', style), mode: 'path', path: p, pathOffset: onPath };
    } else if (w > 8 && h > 8) t = newText(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), '', style, { w, h });
    else t = newText(d.x0, d.y0, '', style);
    t = { ...t, para: { ...t.para, align: o.align }, antialias: o.antialias };
    const layer: TextLayer = { ...baseLayer('Text'), kind: 'text', text: setPlainText(t, ''), raster: new Raster(s.doc.depth, 4) };
    const before = s.doc;
    s.doc = { ...s.doc, layers: insertLayers(s.doc.layers, [layer], s.active, 'above') };
    startEditing(layer, true, 0, before);
  },
  key: (e) => {
    if (edit && e.key === 'Escape') {
      commitText();
      return true;
    }
    return false;
  },
  overlay: (o: Overlay) => {
    const s = current();
    if (!s) return;
    const { ctx } = o;
    if (boxDrag) {
      const [a, b] = o.toScreen(boxDrag.x0, boxDrag.y0);
      const [c, d] = o.toScreen(boxDrag.x1, boxDrag.y1);
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b));
      ctx.restore();
    }
    const l = layerOf();
    if (!edit || !l) return;
    ctx.save();
    // The box (paragraph text) or the bounds.
    if (l.text.mode === 'box' && l.text.box) {
      const [a, b] = o.toScreen(l.text.x, l.text.y);
      const [c, d] = o.toScreen(l.text.x + l.text.box.w, l.text.y + l.text.box.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(a, b, c - a, d - b);
      ctx.setLineDash([]);
    }
    const [i0, i1] = [Math.min(edit.start, edit.end), Math.max(edit.start, edit.end)];
    if (i0 !== i1) {
      // Selection highlight, one box per line.
      ctx.fillStyle = 'rgba(80,150,255,0.35)';
      let k = i0;
      while (k < i1) {
        const c0 = caretAt(l.text, k);
        let k2 = k + 1;
        while (k2 < i1 && Math.abs(caretAt(l.text, k2).y - c0.y) < 0.5) k2++;
        const c1 = caretAt(l.text, k2);
        const sameLine = Math.abs(c1.y - c0.y) < 0.5;
        const [a, b] = o.toScreen(c0.x, c0.y - c0.h * 0.8);
        const [c] = o.toScreen(sameLine ? c1.x : c0.x + 4, c0.y);
        ctx.fillRect(a, b, Math.max(2, c - a), c0.h * o.zoom);
        k = k2;
      }
    }
    // Caret (blinking).
    if (Math.floor(o.time * 2) % 2 === 0 || i0 !== i1) {
      const c = caretAt(l.text, edit.end);
      const [x, y] = o.toScreen(c.x, c.y);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y - c.h * 0.8 * o.zoom);
      ctx.lineTo(x, y + c.h * 0.2 * o.zoom);
      ctx.stroke();
    }
    ctx.restore();
    // Keep the hidden field near the caret (input method windows appear there).
    const c = caretAt(l.text, edit.end);
    const [sx, sy] = toScreen(c.x, c.y);
    const r = viewport.el?.getBoundingClientRect();
    if (r) {
      edit.input.style.left = `${r.left + sx}px`;
      edit.input.style.top = `${r.top + sy}px`;
    }
  },
  active: () => !!edit,
  commit: () => commitText(),
  cancel: () => commitText(),
  leave: () => commitText(),
};
