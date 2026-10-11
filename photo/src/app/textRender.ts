// Drawing text layers with the browser's text engine (Canvas 2D): point
// text, paragraph text wrapped in its box (aligned, justified, indented),
// text on a path, rotation, warps, and the character settings — size,
// weight, italic, tracking, leading, baseline shift, all caps and small caps,
// kerning and ligatures on or off, underline, strikethrough, horizontal and
// vertical scale, faux bold and faux italic.

import { charStyleAt, type CharStyle, type TextModel } from '../core/text';
import { flatten as flattenPath, pointAt } from '../core/path';
import type { Rect } from '../core/types';

export interface LaidGlyphRun {
  text: string;
  style: CharStyle;
  x: number;
  width: number;
}

export interface LaidLine {
  runs: LaidGlyphRun[];
  /** Baseline y relative to the text's top. */
  baseline: number;
  width: number;
  ascent: number;
  descent: number;
  /** Characters [from, to) of the text on this line. */
  from: number;
  to: number;
  justifyGap: number;
}

let measureCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
function measureCtx(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  if (!measureCanvas) measureCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
  return measureCanvas.getContext('2d') as CanvasRenderingContext2D;
}

export function fontString(s: CharStyle, sizeScale = 1): string {
  const size = s.caps === 'small' ? s.size * sizeScale : s.size;
  const fam = /[\s,]/.test(s.family) && !/["']/.test(s.family) ? `"${s.family}"` : s.family;
  return `${s.italic ? 'italic ' : ''}${Math.round(s.weight)} ${Math.max(1, size)}px ${fam}, "Inter Variable", system-ui, sans-serif`;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function setupCtx(ctx: Ctx, s: CharStyle): void {
  ctx.font = fontString(s);
  const c = ctx as Ctx & { letterSpacing?: string; fontKerning?: string; fontVariantCaps?: string; textRendering?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${(s.tracking / 1000) * s.size}px`;
  if ('fontKerning' in c) c.fontKerning = s.kerning ? 'normal' : 'none';
  if ('fontVariantCaps' in c) c.fontVariantCaps = s.caps === 'small' ? 'small-caps' : 'normal';
  if ('textRendering' in c) c.textRendering = s.ligatures ? 'optimizeLegibility' : 'optimizeSpeed';
}

const shown = (text: string, s: CharStyle) => (s.caps === 'all' ? text.toUpperCase() : text);

function measure(text: string, s: CharStyle): number {
  const ctx = measureCtx();
  setupCtx(ctx, s);
  // Ligatures off: measure letter by letter so none form.
  const t = shown(text, s);
  const w = s.ligatures ? ctx.measureText(t).width : [...t].reduce((n, ch) => n + ctx.measureText(ch).width, 0);
  return (w * s.hScale) / 100;
}

function metrics(s: CharStyle): { ascent: number; descent: number } {
  const ctx = measureCtx();
  setupCtx(ctx, s);
  const m = ctx.measureText('Hgjy');
  const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? s.size * 0.8;
  const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? s.size * 0.2;
  return { ascent: (ascent * s.vScale) / 100, descent: (descent * s.vScale) / 100 };
}

/** Lay the text out in lines (wrapping in the box for paragraph text). */
export function layout(t: TextModel): LaidLine[] {
  const text = t.runs.map((r) => r.text).join('');
  const boxW = t.mode === 'box' && t.box ? Math.max(1, t.box.w - t.para.indentLeft - t.para.indentRight) : Infinity;
  const lines: LaidLine[] = [];
  const paragraphs = text.split('\n');
  let index = 0;
  let y = 0;
  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi]!;
    if (pi > 0) y += t.para.spaceBefore;
    // Words (keeping spaces with the word before).
    const tokens = para.match(/\S+\s*|\s+/g) ?? [''];
    let line: { tokens: { text: string; at: number }[]; width: number } = { tokens: [], width: 0 };
    const flush = (last: boolean) => {
      const from = line.tokens[0]?.at ?? index,
        lineText = line.tokens.map((x) => x.text).join('');
      const runs: LaidGlyphRun[] = [];
      let x = 0;
      // Split the line into runs of the same style.
      let i = 0;
      while (i < lineText.length) {
        const st = charStyleAt(t, from + i);
        let j = i + 1;
        while (j < lineText.length && JSON.stringify(charStyleAt(t, from + j)) === JSON.stringify(st)) j++;
        const piece = lineText.slice(i, j);
        const w = measure(piece, st);
        runs.push({ text: piece, style: st, x, width: w });
        x += w;
        i = j;
      }
      if (!runs.length) runs.push({ text: '', style: charStyleAt(t, from), x: 0, width: 0 });
      let ascent = 0,
        descent = 0,
        lead = 0;
      for (const r of runs) {
        const m = metrics(r.style);
        ascent = Math.max(ascent, m.ascent);
        descent = Math.max(descent, m.descent);
        lead = Math.max(lead, r.style.leading > 0 ? r.style.leading : r.style.size * 1.2);
      }
      const trimmed = lineText.replace(/\s+$/, '');
      const width = trimmed.length < lineText.length ? measureWidthUpTo(runs, trimmed.length) : x;
      if (lines.length === 0 && pi === 0) y += ascent;
      else y += lead;
      const spaces = (trimmed.match(/ /g) ?? []).length;
      const justifyGap = t.para.align === 'justify' && !last && Number.isFinite(boxW) && spaces > 0 ? (boxW - width) / spaces : 0;
      lines.push({ runs, baseline: y, width, ascent, descent, from, to: from + lineText.length, justifyGap });
      line = { tokens: [], width: 0 };
    };
    let at = index;
    let firstLine = true;
    for (const tok of tokens) {
      const st = charStyleAt(t, at);
      const w = measure(tok, st);
      const avail = boxW - (firstLine ? t.para.indentFirst : 0);
      if (line.tokens.length && line.width + w > avail && tok.trim()) {
        flush(false);
        firstLine = false;
      }
      line.tokens.push({ text: tok, at });
      line.width += w;
      at += tok.length;
    }
    flush(true);
    index += para.length + 1;
    y += t.para.spaceAfter;
  }
  return lines;
}

function measureWidthUpTo(runs: LaidGlyphRun[], chars: number): number {
  let n = 0,
    w = 0;
  for (const r of runs) {
    if (n + r.text.length <= chars) {
      w = r.x + r.width;
      n += r.text.length;
      continue;
    }
    w = r.x + measure(r.text.slice(0, chars - n), r.style);
    break;
  }
  return w;
}

/** The x where each line starts (alignment and indents), relative to the text's origin. */
function lineX(t: TextModel, l: LaidLine, i: number, lines: LaidLine[]): number {
  const firstOfPara = i === 0 || t.runs.map((r) => r.text).join('')[l.from - 1] === '\n';
  const indent = t.para.indentLeft + (firstOfPara ? t.para.indentFirst : 0);
  if (t.mode === 'box' && t.box) {
    const room = t.box.w - t.para.indentLeft - t.para.indentRight - (firstOfPara ? t.para.indentFirst : 0);
    if (t.para.align === 'center') return indent + (room - l.width) / 2;
    if (t.para.align === 'right') return indent + room - l.width;
    return indent;
  }
  // Point text: aligned around the origin.
  void lines;
  if (t.para.align === 'center') return -l.width / 2;
  if (t.para.align === 'right') return -l.width;
  return 0;
}

/** Bounds of the drawn text in document pixels (before rotation; padded). */
export function textBounds(t: TextModel, lines = layout(t)): Rect {
  if (t.mode === 'box' && t.box) return { x: t.x, y: t.y, w: t.box.w, h: t.box.h };
  let x0 = Infinity,
    x1 = -Infinity;
  lines.forEach((l, i) => {
    const lx = lineX(t, l, i, lines);
    x0 = Math.min(x0, lx);
    x1 = Math.max(x1, lx + l.width);
  });
  const first = lines[0];
  const last = lines[lines.length - 1];
  const top = -(first?.ascent ?? t.base.size);
  const bottom = (last?.baseline ?? 0) - (first?.baseline ?? 0) + (last?.descent ?? t.base.size * 0.25);
  if (!Number.isFinite(x0)) {
    x0 = 0;
    x1 = 0;
  }
  return { x: t.x + x0, y: t.y + top, w: Math.max(1, x1 - x0), h: Math.max(1, bottom - top) };
}

function drawRun(ctx: Ctx, r: LaidGlyphRun, x: number, y: number, gap: number): void {
  const s = r.style;
  setupCtx(ctx, s);
  ctx.fillStyle = `rgb(${s.color.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`;
  ctx.strokeStyle = ctx.fillStyle;
  const t = shown(r.text, s);
  ctx.save();
  ctx.translate(x, y - s.baselineShift);
  if (s.fauxItalic) ctx.transform(1, 0, -0.2, 1, 0, 0);
  ctx.scale(s.hScale / 100, s.vScale / 100);
  const draw = (str: string, px: number) => {
    ctx.fillText(str, px, 0);
    if (s.fauxBold) {
      ctx.lineWidth = Math.max(1, s.size * 0.035);
      ctx.lineJoin = 'round';
      ctx.strokeText(str, px, 0);
    }
  };
  if (!s.ligatures || gap) {
    // Letter by letter (no ligatures; justified spaces get the extra room).
    let px = 0;
    for (const ch of t) {
      draw(ch, px);
      px += ctx.measureText(ch).width + (ch === ' ' ? gap / (s.hScale / 100) : 0);
    }
  } else draw(t, 0);
  ctx.restore();
  if (s.underline || s.strike) {
    const lw = Math.max(1, s.size / 16);
    ctx.fillRect(x, y + (s.underline ? s.size * 0.12 : -s.size * 0.3) - s.baselineShift, r.width + (gap ? gap * (t.match(/ /g)?.length ?? 0) : 0), lw);
  }
}

/** Draw the text into a canvas positioned at `origin` (document pixels) of size w × h. */
export function drawText(ctx: Ctx, t: TextModel, origin: { x: number; y: number }): void {
  const lines = layout(t);
  ctx.save();
  ctx.translate(-origin.x, -origin.y);
  if (t.rotation) {
    ctx.translate(t.x, t.y);
    ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.translate(-t.x, -t.y);
  }
  ctx.textBaseline = 'alphabetic';
  if (t.mode === 'path' && t.path) {
    const poly = flattenPath(t.path, 0.5)[0]?.pts ?? [];
    let d = t.pathOffset ?? 0;
    const text = t.runs.map((r) => r.text).join('');
    for (let i = 0; i < text.length; i++) {
      const st = charStyleAt(t, i);
      const ch = shown(text[i]!, st);
      setupCtx(ctx, st);
      const w = (ctx.measureText(ch).width * st.hScale) / 100;
      const p = pointAt(poly, d + w / 2);
      if (!p) break;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      drawRun(ctx, { text: text[i]!, style: st, x: 0, width: w }, -w / 2, 0, 0);
      ctx.restore();
      d += w;
    }
    ctx.restore();
    return;
  }
  const top = t.mode === 'box' ? t.y : t.y - (lines[0]?.baseline ?? 0);
  lines.forEach((l, i) => {
    const lx = t.x + lineX(t, l, i, lines);
    let extra = 0;
    for (const r of l.runs) {
      drawRun(ctx, r, lx + r.x + extra, top + l.baseline, l.justifyGap);
      if (l.justifyGap) extra += l.justifyGap * ((shown(r.text, r.style).match(/ /g) ?? []).length);
    }
  });
  ctx.restore();
}

/** Where the text lands (document pixels), including rotation, for the layer's pixels. */
export function drawnBounds(t: TextModel): Rect {
  let b: Rect;
  if (t.mode === 'path' && t.path) {
    const pts = flattenPath(t.path, 1)[0]?.pts ?? [];
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]!);
      x1 = Math.max(x1, pts[i]!);
      y0 = Math.min(y0, pts[i + 1]!);
      y1 = Math.max(y1, pts[i + 1]!);
    }
    const pad = t.base.size * 1.5;
    b = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  } else b = textBounds(t);
  const pad = Math.ceil(t.base.size * 0.5) + 4;
  b = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
  if (t.rotation) {
    const r = (t.rotation * Math.PI) / 180;
    const cs = [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x, b.y + b.h],
      [b.x + b.w, b.y + b.h],
    ].map(([x, y]) => {
      const dx = x! - t.x,
        dy = y! - t.y;
      return [t.x + dx * Math.cos(r) - dy * Math.sin(r), t.y + dx * Math.sin(r) + dy * Math.cos(r)];
    });
    const xs = cs.map((c) => c[0]!),
      ys = cs.map((c) => c[1]!);
    b = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  return { x: Math.floor(b.x), y: Math.floor(b.y), w: Math.ceil(b.w) + 2, h: Math.ceil(b.h) + 2 };
}

/** Caret position for a character index (document pixels): x, baseline y and line height. */
export function caretAt(t: TextModel, index: number): { x: number; y: number; h: number } {
  const lines = layout(t);
  const top = t.mode === 'box' ? t.y : t.y - (lines[0]?.baseline ?? 0);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (index <= l.to || i === lines.length - 1) {
      const lx = t.x + lineX(t, l, i, lines);
      let x = lx;
      let n = l.from;
      for (const r of l.runs) {
        if (index <= n + r.text.length) {
          x = lx + r.x + measure(r.text.slice(0, index - n), r.style);
          break;
        }
        n += r.text.length;
        x = lx + r.x + r.width;
      }
      return { x, y: top + l.baseline, h: l.ascent + l.descent };
    }
  }
  return { x: t.x, y: t.y, h: t.base.size };
}

/** The character index nearest a document point (clicking in text). */
export function indexAt(t: TextModel, x: number, y: number): number {
  const lines = layout(t);
  const top = t.mode === 'box' ? t.y : t.y - (lines[0]?.baseline ?? 0);
  let best = 0;
  let bd = Infinity;
  lines.forEach((l, i) => {
    const by = top + l.baseline;
    const dy = y < by - l.ascent ? by - l.ascent - y : y > by + l.descent ? y - by - l.descent : 0;
    const lx = t.x + lineX(t, l, i, lines);
    for (let k = l.from; k <= l.to; k++) {
      let cx = lx;
      let n = l.from;
      for (const r of l.runs) {
        if (k <= n + r.text.length) {
          cx = lx + r.x + measure(r.text.slice(0, k - n), r.style);
          break;
        }
        n += r.text.length;
      }
      const d = dy * 1000 + Math.abs(cx - x);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
  });
  return best;
}
