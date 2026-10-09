// Variables ({{name}}), brand tokens ($accent) and colors.

import { timerText } from './timer';
import type { BrandTokens, TitleProject, Values, Variable } from './types';

/** A neutral broadcast look: near-black boxes, white words, one restrained accent. */
export const DEFAULT_TOKENS: BrandTokens = {
  font: 'Inter',
  fontSub: 'Inter',
  text: '#ffffff',
  textSub: '#d5d8de',
  accent: '#d23c3c',
  accentText: '#ffffff',
  box: '#121417',
  boxAlt: '#24282e',
};

export const TOKEN_KEYS: (keyof BrandTokens)[] = ['font', 'fontSub', 'text', 'textSub', 'accent', 'accentText', 'box', 'boxAlt'];

export const TOKEN_LABELS: Record<keyof BrandTokens, string> = {
  font: 'Main font',
  fontSub: 'Second font',
  text: 'Text',
  textSub: 'Second text',
  accent: 'Accent',
  accentText: 'Text on accent',
  box: 'Box',
  boxAlt: 'Second box',
};

const VAR = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

/** Keys of the variables a string uses. */
export function variablesIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(VAR)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** The clock of the frame being drawn (seconds since the graphic was taken), for timers that start when taken. */
let renderClock: number | null = null;
export function setRenderClock(clock: number | null): number | null {
  const before = renderClock;
  renderClock = clock;
  return before;
}

/** A variable's value as shown (numbers formatted, lists one item a line, timers running). */
export function formatValue(v: Variable | undefined, raw: string): string {
  if (!v) return raw;
  if (v.type === 'timer') return timerText(v, raw, Date.now(), renderClock);
  if (v.type === 'number') {
    const n = Number(raw);
    const body = raw.trim() === '' || !Number.isFinite(n) ? raw : v.decimals !== undefined ? n.toFixed(Math.max(0, Math.min(6, v.decimals))) : String(n);
    return `${v.prefix ?? ''}${body}${v.suffix ?? ''}`;
  }
  if (v.type === 'list' && v.separator !== undefined)
    return raw
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
      .join(v.separator);
  return raw;
}

/** The values to draw with: the sample values, then those given. */
export function valuesFor(p: TitleProject, given: Values | undefined): Values {
  const out: Values = {};
  for (const v of p.variables) out[v.key] = v.value;
  if (given) for (const [k, val] of Object.entries(given)) if (typeof val === 'string') out[k] = val;
  return out;
}

/** Put the variables' values into a string ({{key}}; unknown keys stay as written). */
export function fill(s: string, values: Values, vars?: Variable[]): string {
  if (!s.includes('{{')) return s;
  return s.replace(VAR, (whole, key: string) => {
    const raw = values[key];
    if (raw === undefined) return whole;
    return formatValue(
      vars?.find((v) => v.key === key),
      raw,
    );
  });
}

/** Tokens with the host's brand on top of the project's own. */
export function tokensFor(p: TitleProject, brand: Partial<BrandTokens> | undefined): BrandTokens {
  const out = { ...DEFAULT_TOKENS, ...p.tokens };
  if (brand) for (const k of TOKEN_KEYS) if (brand[k]) out[k] = brand[k] as string;
  return out;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export const isHex = (s: string) => HEX.test(s);

/** A color reference to a CSS color: tokens and variables resolved, invalid → fallback. */
export function resolveColor(ref: string | undefined, tokens: BrandTokens, values: Values, fallback = '#ffffff'): string {
  if (!ref) return fallback;
  let s = ref.trim();
  for (let n = 0; n < 3; n++) {
    if (s.startsWith('$')) {
      const v = tokens[s.slice(1) as keyof BrandTokens];
      if (!v) return fallback;
      s = v;
    } else if (s.startsWith('{{')) {
      const filled = fill(s, values).trim();
      if (filled === s) return fallback;
      s = filled;
    } else break;
  }
  if (isHex(s) || /^rgba?\(/i.test(s) || s === 'transparent') return s;
  return fallback;
}

/** A font name: "$font" / "$fontSub" from the brand. */
export function resolveFont(name: string, tokens: BrandTokens): string {
  if (name === '$font') return tokens.font;
  if (name === '$fontSub') return tokens.fontSub;
  return name;
}

/** [r, g, b, a] 0–255 / 0–1 from a hex color. */
export function parseHex(hex: string): [number, number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0) || 0, n(2) || 0, n(4) || 0, h.length === 8 ? n(6) / 255 : 1];
}

/** Relative luminance (WCAG). */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c, i) => (i < 3 ? c / 255 : c)) as [number, number, number, number];
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black or white, whichever reads better on the color. */
export const readableOn = (bg: string) => (contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111');

/** Every variable key the project's text, colors and images use, in order of first use. */
export function usedVariables(p: TitleProject): string[] {
  const out: string[] = [];
  const add = (s: string | undefined) => {
    if (s) for (const k of variablesIn(s)) if (!out.includes(k)) out.push(k);
  };
  const walk = (o: unknown) => {
    if (typeof o === 'string') add(o);
    else if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') for (const v of Object.values(o)) walk(v);
  };
  walk(p.compositions);
  // {{row}}: the row number inside a group repeated for each row (not a field).
  if (JSON.stringify(p.compositions).includes('"repeat":{')) return out.filter((k) => k !== 'row');
  return out;
}

/** A variable key from a label ("Score home" → "score_home"). */
export const keyFrom = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, '_$1')
    .slice(0, 40) || 'field';
