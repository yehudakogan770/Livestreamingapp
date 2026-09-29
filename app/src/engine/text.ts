// Text inputs (mirrors crates/engine/src/text.rs): defaults and ready-made starts.

import type { TextInput } from './types/TextInput';
import type { TextLayout } from './types/TextLayout';
import type { TextStyle } from './types/TextStyle';
import type { TextDesign } from './types/TextDesign';

export function defaultTextStyle(): TextStyle {
  return {
    font: 'Segoe UI',
    size: 54,
    weight: 600,
    color: '#ffffff',
    align: 'left',
    outline: 0,
    outlineColor: '#000000',
    shadow: true,
    boxOn: true,
    boxColor: '#101216',
    boxOpacity: 0.8,
    padding: 24,
    radius: 6,
    lineHeight: 1.2,
    letterSpacing: 0,
    speed: 160,
    design: 'box',
    accent: '#2f80ed',
    animate: true,
  };
}

/** How long the build-on animation takes, ms. */
export const BUILD_MS = 800;

/** The looks a lower third or title can have. */
export const TEXT_DESIGNS: { id: TextDesign; name: string; hint: string }[] = [
  { id: 'box', name: 'Box', hint: 'One box behind both lines' },
  { id: 'bar', name: 'Accent bar', hint: 'A box with a coloured bar at its side' },
  { id: 'split', name: 'Two-tone', hint: 'The name on the accent colour, the title under it' },
  { id: 'underline', name: 'Underline', hint: 'No box; a coloured line between the lines' },
  { id: 'gradient', name: 'Gradient', hint: 'A box fading from the accent colour' },
  { id: 'glass', name: 'Glass', hint: 'Frosted glass' },
];

/** Accent colours to pick from quickly. */
export const ACCENTS = ['#2f80ed', '#e0473b', '#f2b233', '#27ae60', '#9b51e0', '#ffffff'];

const ease = (x: number) => 1 - (1 - x) ** 3;
const span = (t: number, from: number, to: number) => ease(Math.min(1, Math.max(0, (t - from) / (to - from))));

/**
 * How far each part of a build-on is at `ms` after it came on (1 = done):
 * the box opens, the bar and line grow, then the words rise in.
 */
export function buildAt(ms: number, animate: boolean): { box: number; subBox: number; bar: number; line: number; text: number; sub: number } {
  if (!animate) return { box: 1, subBox: 1, bar: 1, line: 1, text: 1, sub: 1 };
  return {
    bar: span(ms, 0, 300),
    box: span(ms, 80, 480),
    subBox: span(ms, 300, 700),
    line: span(ms, 150, 550),
    text: span(ms, 250, 650),
    sub: span(ms, 400, BUILD_MS),
  };
}

/** A good start for each kind of text. */
export const TEXT_TEMPLATES: { layout: TextLayout; name: string; hint: string; make: () => TextInput }[] = [
  {
    layout: 'lowerThird',
    name: 'Lower third',
    hint: 'Name and title, low on the left',
    make: () => ({ layout: 'lowerThird', text: '[Speaker name]', sub: '[Title]', style: defaultTextStyle() }),
  },
  {
    layout: 'title',
    name: 'Title',
    hint: 'Big, in the middle',
    make: () => ({
      layout: 'title',
      text: '[Event name]',
      sub: '[Date · place]',
      style: { ...defaultTextStyle(), font: 'Frank Ruhl Libre', size: 110, weight: 700, align: 'center', boxOn: false },
    }),
  },
  {
    layout: 'ticker',
    name: 'Ticker',
    hint: 'A line scrolling along the bottom',
    make: () => ({ layout: 'ticker', text: '[Sponsors, thank-yous, next up…]', sub: '', style: { ...defaultTextStyle(), size: 40, radius: 0, padding: 14 } }),
  },
  {
    layout: 'fullScreen',
    name: 'Full-screen message',
    hint: 'A message filling the screen',
    make: () => ({
      layout: 'fullScreen',
      text: 'Please take your seats',
      sub: 'The program begins in a few minutes',
      style: { ...defaultTextStyle(), size: 96, align: 'center', boxOn: false },
    }),
  },
];

export const TEXT_FONTS = ['Segoe UI', 'Heebo', 'Frank Ruhl Libre', 'David Libre', 'Arial', 'Georgia', 'Impact', 'Consolas'];

/** A colour with transparency, for the background box. */
export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Text in Hebrew (or another right-to-left script) reads right to left. */
export const isRtl = (t: string) => /[֐-׿؀-ۿ]/.test(t);
