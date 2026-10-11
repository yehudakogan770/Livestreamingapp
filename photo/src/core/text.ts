// Text layers' model: point text, paragraph text in a box, and text on a
// path, with character and paragraph settings (Character and Paragraph
// panels). Drawing is in ui/textRender.ts (it needs a canvas).

import type { VectorPath } from './path';

export interface CharStyle {
  family: string;
  weight: number;
  italic: boolean;
  /** Pixels. */
  size: number;
  color: [number, number, number];
  /** Thousandths of an em. */
  tracking: number;
  /** Line height in pixels; 0 = auto (120 %). */
  leading: number;
  baselineShift: number;
  caps: 'normal' | 'all' | 'small';
  underline: boolean;
  strike: boolean;
  /** Kerning from the font's metrics or none. */
  kerning: boolean;
  ligatures: boolean;
  /** Old-style or tabular figures and the like, as CSS font-feature-settings. */
  features: string;
  /** Percent. */
  hScale: number;
  vScale: number;
  fauxBold: boolean;
  fauxItalic: boolean;
}

export interface TextRun {
  text: string;
  style?: Partial<CharStyle>;
}

export interface ParaStyle {
  align: 'left' | 'center' | 'right' | 'justify';
  indentLeft: number;
  indentRight: number;
  indentFirst: number;
  spaceBefore: number;
  spaceAfter: number;
  direction: 'ltr' | 'rtl';
}

export interface TextModel {
  runs: TextRun[];
  base: CharStyle;
  para: ParaStyle;
  mode: 'point' | 'box' | 'path';
  /** Point text: the first line's baseline start. Box: the box's top left. */
  x: number;
  y: number;
  box?: { w: number; h: number };
  /** Text on a path: the path (document coordinates) and where along it the text starts (pixels). */
  path?: VectorPath;
  pathOffset?: number;
  /** Rotation in degrees about (x, y). */
  rotation: number;
  antialias: 'none' | 'sharp' | 'smooth';
  /** Warp text (Arc, Arch, Bulge, Flag, Wave, Rise) with bend −1..1. */
  warp?: { style: 'arc' | 'arch' | 'bulge' | 'flag' | 'wave' | 'rise'; bend: number };
}

export const defaultChar = (): CharStyle => ({
  family: 'Inter Variable',
  weight: 400,
  italic: false,
  size: 72,
  color: [0, 0, 0],
  tracking: 0,
  leading: 0,
  baselineShift: 0,
  caps: 'normal',
  underline: false,
  strike: false,
  kerning: true,
  ligatures: true,
  features: '',
  hScale: 100,
  vScale: 100,
  fauxBold: false,
  fauxItalic: false,
});

export const defaultPara = (): ParaStyle => ({ align: 'left', indentLeft: 0, indentRight: 0, indentFirst: 0, spaceBefore: 0, spaceAfter: 0, direction: 'ltr' });

export const plainText = (t: TextModel) => t.runs.map((r) => r.text).join('');

/** Set the whole text (one run, keeping the first run's style). */
export function setPlainText(t: TextModel, text: string): TextModel {
  return { ...t, runs: [{ text, style: t.runs[0]?.style }] };
}

/** Apply a style to characters [from, to). */
export function styleRange(t: TextModel, from: number, to: number, style: Partial<CharStyle>): TextModel {
  const out: TextRun[] = [];
  let at = 0;
  for (const r of t.runs) {
    const a = at,
      b = at + r.text.length;
    at = b;
    if (b <= from || a >= to) {
      out.push(r);
      continue;
    }
    const s = Math.max(from, a) - a,
      e = Math.min(to, b) - a;
    if (s > 0) out.push({ text: r.text.slice(0, s), style: r.style });
    out.push({ text: r.text.slice(s, e), style: { ...r.style, ...style } });
    if (e < r.text.length) out.push({ text: r.text.slice(e), style: r.style });
  }
  // Join neighbours with the same style.
  const merged: TextRun[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && JSON.stringify(last.style ?? {}) === JSON.stringify(r.style ?? {})) last.text += r.text;
    else if (r.text) merged.push({ ...r });
  }
  return { ...t, runs: merged.length ? merged : [{ text: '' }] };
}

/** The style of each character. */
export function charStyleAt(t: TextModel, index: number): CharStyle {
  let at = 0;
  for (const r of t.runs) {
    if (index < at + r.text.length) return { ...t.base, ...r.style };
    at += r.text.length;
  }
  const last = t.runs[t.runs.length - 1];
  return { ...t.base, ...last?.style };
}

export function newText(x: number, y: number, text: string, style: Partial<CharStyle> = {}, box?: { w: number; h: number }): TextModel {
  return {
    runs: [{ text }],
    base: { ...defaultChar(), ...style },
    para: defaultPara(),
    mode: box ? 'box' : 'point',
    x,
    y,
    box,
    rotation: 0,
    antialias: 'smooth',
  };
}
