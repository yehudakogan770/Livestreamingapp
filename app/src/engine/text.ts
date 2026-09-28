// Text inputs (mirrors crates/engine/src/text.rs): defaults and ready-made starts.

import type { TextInput } from './types/TextInput';
import type { TextLayout } from './types/TextLayout';
import type { TextStyle } from './types/TextStyle';

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
