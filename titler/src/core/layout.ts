// Text layout: inline styling, wrapping in the box, shrink-to-fit, and the
// place of every letter, word and line (for text animators).

import type { TextStyle } from './types';

/** How a run of text differs from the layer's style. */
export interface RunStyle {
  bold: boolean;
  italic: boolean;
  color: string | null;
  /** Percent of the size. */
  scale: number;
  font: string | null;
}

export interface Run {
  text: string;
  style: RunStyle;
}

const PLAIN: RunStyle = { bold: false, italic: false, color: null, scale: 100, font: null };

/**
 * Split inline styling into runs: [b]bold[/b], [i]italic[/i],
 * [c=#ff0000]color[/c] (or [c=$accent]), [s=80]smaller[/s], [f=Font]font[/f].
 * Tags not understood stay as text.
 */
export function parseRich(text: string): Run[] {
  const runs: Run[] = [];
  const stack: RunStyle[] = [PLAIN];
  const tag = /\[(\/?)(b|i|c|s|f)(?:=([^\]]{1,60}))?\]/g;
  let last = 0;
  const push = (s: string) => {
    if (!s) return;
    const style = stack[stack.length - 1]!;
    const prev = runs[runs.length - 1];
    if (prev && prev.style === style) prev.text += s;
    else runs.push({ text: s, style });
  };
  for (const m of text.matchAll(tag)) {
    push(text.slice(last, m.index));
    last = m.index! + m[0].length;
    const top = stack[stack.length - 1]!;
    if (m[1]) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const arg = m[3];
    switch (m[2]) {
      case 'b':
        stack.push({ ...top, bold: true });
        break;
      case 'i':
        stack.push({ ...top, italic: true });
        break;
      case 'c':
        stack.push({ ...top, color: arg ?? null });
        break;
      case 's':
        stack.push({ ...top, scale: Math.min(400, Math.max(10, Number(arg) || 100)) });
        break;
      case 'f':
        stack.push({ ...top, font: arg ?? null });
        break;
    }
  }
  push(text.slice(last));
  return runs;
}

/** Words without their styling tags. */
export const plainText = (text: string) =>
  parseRich(text)
    .map((r) => r.text)
    .join('');

export interface Glyph {
  ch: string;
  /** Left edge in the line, px. */
  x: number;
  w: number;
  style: RunStyle;
  char: number;
  word: number;
  line: number;
}

export interface Line {
  /** Left edge (after alignment) and baseline, layer space. */
  x: number;
  y: number;
  width: number;
  glyphs: Glyph[];
}

export interface TextLayout {
  size: number;
  lines: Line[];
  /** Total height of the lines. */
  height: number;
  width: number;
  counts: { char: number; word: number; line: number };
  /** Did not fit the box even at the smallest size. */
  overflow: boolean;
}

/** Measures text in a font string (canvas `font`). */
export type Measure = (font: string, text: string) => number;

export function fontString(style: TextStyle, run: RunStyle, size: number, family: string): string {
  const weight = run.bold ? Math.max(700, style.weight) : style.weight;
  const italic = run.italic || style.italic ? 'italic ' : '';
  const px = (size * run.scale) / 100;
  const name = run.font ?? family;
  return `${italic}${weight} ${round(px)}px "${name}", "Inter", "Segoe UI", system-ui, sans-serif`;
}

const round = (v: number) => Math.round(v * 100) / 100;

interface Token {
  text: string;
  style: RunStyle;
  space: boolean;
  newline: boolean;
}

function tokens(runs: Run[], caps: boolean): Token[] {
  const out: Token[] = [];
  for (const r of runs) {
    const text = caps ? r.text.toUpperCase() : r.text;
    for (const part of text.split(/(\n| +)/)) {
      if (!part) continue;
      out.push({ text: part, style: r.style, space: part[0] === ' ', newline: part === '\n' });
    }
  }
  return out;
}

export interface LayoutBox {
  w: number;
  h: number;
  wrap: boolean;
  fit: 'none' | 'shrink';
  minSize?: number;
  maxLines?: number;
}

/** Lay out the text at one size. */
function layoutAt(runs: Run[], style: TextStyle, family: string, size: number, box: LayoutBox, measure: Measure): TextLayout {
  const toks = tokens(runs, !!style.caps);
  const width = (t: Token) => measure(fontString(style, t.style, size, family), t.text) + style.tracking * [...t.text].length;
  type Raw = Token & { w: number };
  const lines: Raw[][] = [[]];
  let lineW = 0;
  const limit = box.wrap && box.w > 0 ? box.w : Infinity;
  for (const t of toks) {
    if (t.newline) {
      lines.push([]);
      lineW = 0;
      continue;
    }
    const cur = lines[lines.length - 1]!;
    const w = width(t);
    if (t.space) {
      if (cur.length === 0 && lines.length > 1) continue; // no leading space on a wrapped line
      cur.push({ ...t, w });
      lineW += w;
      continue;
    }
    if (lineW + w > limit && cur.some((x) => !x.space)) {
      // Wrap: drop trailing spaces, start a new line.
      while (cur.length && cur[cur.length - 1]!.space) cur.pop();
      lines.push([]);
      lineW = 0;
    }
    const now = lines[lines.length - 1]!;
    if (w > limit) {
      // A word longer than the box: broken between letters.
      let part = '';
      for (const ch of t.text) {
        const pw = measure(fontString(style, t.style, size, family), part + ch) + style.tracking * ([...part].length + 1);
        if (pw > limit && part) {
          lines[lines.length - 1]!.push({ ...t, text: part, w: width({ ...t, text: part }) });
          lines.push([]);
          part = '';
        }
        part += ch;
      }
      const l = lines[lines.length - 1]!;
      const pw = width({ ...t, text: part });
      l.push({ ...t, text: part, w: pw });
      lineW = pw;
      continue;
    }
    now.push({ ...t, w });
    lineW += w;
  }
  for (const l of lines) while (l.length && l[l.length - 1]!.space) l.pop();

  let overflow = false;
  let kept = lines;
  if (box.maxLines && box.maxLines > 0 && lines.length > box.maxLines) {
    kept = lines.slice(0, box.maxLines);
    overflow = true;
    const lastLine = kept[kept.length - 1]!;
    const lastTok = lastLine[lastLine.length - 1];
    if (lastTok) lastLine[lastLine.length - 1] = { ...lastTok, text: `${lastTok.text}…`, w: width({ ...lastTok, text: `${lastTok.text}…` }) };
  }

  const lh = size * style.lineHeight;
  const out: Line[] = [];
  let char = 0;
  let word = 0;
  let maxW = 0;
  kept.forEach((l, li) => {
    const glyphs: Glyph[] = [];
    let x = 0;
    l.forEach((t, ti) => {
      const font = fontString(style, t.style, size, family);
      const chars = [...t.text];
      let prefix = '';
      chars.forEach((ch, ci) => {
        const before = measure(font, prefix) + style.tracking * ci;
        prefix += ch;
        const after = measure(font, prefix) + style.tracking * (ci + 1);
        glyphs.push({ ch, x: x + before, w: after - before, style: t.style, char: t.space ? -1 : char++, word: t.space ? -1 : word, line: li });
      });
      x += t.w;
      // A word ends at a space or the end of the line (styled parts of one word stay one word).
      const next = l[ti + 1];
      if (!t.space && (!next || next.space)) word++;
    });
    maxW = Math.max(maxW, x);
    out.push({ x: 0, y: 0, width: x, glyphs });
  });
  const height = out.length * lh;
  const boxW = box.w > 0 ? box.w : maxW;
  // Ascent: about 0.8 of the size above the baseline for most fonts, centered in the line.
  const top = box.h > 0 ? (style.vAlign === 'middle' ? (box.h - height) / 2 : style.vAlign === 'bottom' ? box.h - height : 0) : 0;
  out.forEach((l, i) => {
    l.x = style.align === 'center' ? (boxW - l.width) / 2 : style.align === 'right' ? boxW - l.width : 0;
    l.y = top + i * lh + lh / 2 + size * 0.35;
  });
  if (box.w > 0 && maxW > box.w + 0.5) overflow = true;
  if (box.h > 0 && height > box.h + 0.5) overflow = true;
  return { size, lines: out, height, width: maxW, counts: { char, word, line: out.length }, overflow };
}

/** Lay out a text layer's words in its box, shrinking them to fit if asked. */
export function layoutText(text: string, style: TextStyle, family: string, box: LayoutBox, measure: Measure): TextLayout {
  const runs = parseRich(text);
  const first = layoutAt(runs, style, family, style.size, box, measure);
  if (box.fit !== 'shrink' || !first.overflow) return first;
  const min = Math.max(1, Math.min(style.size, box.minSize ?? style.size * 0.4));
  const atMin = layoutAt(runs, style, family, min, box, measure);
  if (atMin.overflow) return atMin;
  // The largest size that fits (binary search, to a tenth of a pixel).
  let lo = min;
  let hi = style.size;
  let best = atMin;
  for (let n = 0; n < 14 && hi - lo > 0.1; n++) {
    const mid = (lo + hi) / 2;
    const l = layoutAt(runs, style, family, mid, box, measure);
    if (l.overflow) hi = mid;
    else {
      lo = mid;
      best = l;
    }
  }
  return best;
}
