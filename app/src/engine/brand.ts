// The event's look (mirrors Brand in crates/engine/src/event.rs).

import type { Brand } from './types/Brand';
import type { Show } from './types/Show';
import type { TextStyle } from './types/TextStyle';

export function defaultBrand(): Brand {
  return { font: 'Segoe UI', textColor: '#ffffff', accent: '#2f80ed', boxColor: '#101216', boxOpacity: 80, design: 'box' };
}

/** A title's style in the event's look. */
export const branded = (s: TextStyle, b: Brand): TextStyle => ({
  ...s,
  font: b.font,
  color: b.textColor,
  accent: b.accent,
  boxColor: b.boxColor,
  boxOpacity: b.boxOpacity / 100,
  design: b.design,
});

/** Has the event a look of its own (not the starting one)? */
export const hasBrand = (b: Brand | undefined): b is Brand => !!b && JSON.stringify(b) !== JSON.stringify(defaultBrand());

const color = (c: string, d: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : d);

/** Put the look on every title, song and scoreboard (the demo engine's ApplyBrand). */
export function applyBrand(s: Show, brand: Brand): void {
  const d = defaultBrand();
  const b: Brand = {
    ...brand,
    font: brand.font.trim().slice(0, 60) || d.font,
    textColor: color(brand.textColor, d.textColor),
    accent: color(brand.accent, d.accent),
    boxColor: color(brand.boxColor, d.boxColor),
    boxOpacity: Math.min(100, Math.max(0, Math.round(brand.boxOpacity))),
  };
  for (const src of s.sources) {
    const k = src.kind;
    if (k.type === 'text') k.style = branded(k.style, b);
    else if (k.type === 'lyrics') k.style = { ...k.style, font: b.font, color: b.textColor };
    else if (k.type === 'scoreboard') k.home.color = b.accent;
  }
  s.event.brand = b;
}
