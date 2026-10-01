// The event's look (mirrors Brand in crates/engine/src/event.rs).

import type { Brand } from './types/Brand';
import type { Show } from './types/Show';
import type { TextStyle } from './types/TextStyle';

/**
 * Lumora's own logo (app/public/brand): shown when something breaks, during
 * PANIC and at the end of a countdown, until an event sets its own logo.
 */
export function appLogo(): string {
  return typeof document === 'undefined' ? 'brand/lumora-logo.png' : new URL('brand/lumora-logo.png', document.baseURI).href;
}

/** The event's own logo, or Lumora's until it has one. */
export const eventLogo = (ev: { logo?: string | null } | undefined | null): string => ev?.logo || appLogo();

export function defaultBrand(): Brand {
  return {
    font: 'Segoe UI',
    textColor: '#ffffff',
    accent: '#2f80ed',
    boxColor: '#101216',
    boxOpacity: 80,
    design: 'box',
    size: 54,
    weight: 600,
    italic: false,
    uppercase: false,
    align: 'left',
    outline: 0,
    outlineColor: '#000000',
    shadow: true,
    boxOn: true,
    padding: 24,
    radius: 6,
    lineHeight: 120,
    letterSpacing: 0,
    subColor: '',
    subSize: 60,
    subFont: '',
    border: 0,
    borderColor: '#ffffff',
    x: 5,
    y: 10,
    animate: true,
    entrance: 'build',
    fonts: [],
  };
}

/** Ready-made looks: one click sets everything (fonts added for the event stay). */
export const LOOKS: { name: string; look: Partial<Brand> }[] = [
  { name: 'Classic', look: {} },
  {
    name: 'Elegant gold',
    look: {
      font: 'Frank Ruhl Libre',
      textColor: '#f6e7c1',
      accent: '#d4af37',
      boxColor: '#16110a',
      boxOpacity: 88,
      design: 'bar',
      weight: 700,
      radius: 2,
      subColor: '#d4af37',
      subSize: 55,
      letterSpacing: 1,
      entrance: 'fade',
    },
  },
  {
    name: 'Modern',
    look: {
      font: 'Heebo',
      accent: '#00c2a8',
      boxColor: '#0d1b2a',
      boxOpacity: 92,
      design: 'split',
      weight: 800,
      radius: 0,
      uppercase: true,
      letterSpacing: 2,
      subSize: 50,
      entrance: 'slide',
    },
  },
  {
    name: 'Soft glass',
    look: { font: 'Heebo', design: 'glass', weight: 600, radius: 18, padding: 28, border: 0, subColor: '#dfe8f5', entrance: 'rise' },
  },
  {
    name: 'Bold sport',
    look: {
      font: 'Impact',
      accent: '#e0473b',
      boxColor: '#111111',
      boxOpacity: 95,
      design: 'gradient',
      weight: 700,
      italic: true,
      uppercase: true,
      size: 62,
      radius: 0,
      subColor: '#ffd23f',
      entrance: 'slide',
    },
  },
  {
    name: 'Clean white',
    look: {
      font: 'Heebo',
      textColor: '#15181d',
      accent: '#2f80ed',
      boxColor: '#ffffff',
      boxOpacity: 96,
      design: 'bar',
      shadow: false,
      radius: 8,
      subColor: '#4a5563',
      entrance: 'pop',
    },
  },
  {
    name: 'Simple words',
    look: { font: 'Segoe UI', design: 'underline', boxOn: false, weight: 700, outline: 0, shadow: true, accent: '#f2b233', entrance: 'fade' },
  },
  {
    name: 'Center stage',
    look: {
      font: 'David Libre',
      design: 'box',
      align: 'center',
      x: 5,
      y: 8,
      radius: 40,
      padding: 30,
      border: 3,
      borderColor: '#d4af37',
      accent: '#d4af37',
      boxColor: '#0b1530',
      entrance: 'pop',
    },
  },
];

/** A title's style in the event's look. Size, alignment, box and place only go on name titles. */
export const branded = (s: TextStyle, b: Brand, nameTitle = true): TextStyle => ({
  ...s,
  font: b.font,
  color: b.textColor,
  accent: b.accent,
  boxColor: b.boxColor,
  boxOpacity: b.boxOpacity / 100,
  design: b.design,
  weight: b.weight,
  italic: b.italic,
  uppercase: b.uppercase,
  outline: b.outline,
  outlineColor: b.outlineColor,
  shadow: b.shadow,
  padding: b.padding,
  radius: b.radius,
  lineHeight: b.lineHeight / 100,
  letterSpacing: b.letterSpacing,
  subColor: b.subColor,
  subSize: b.subSize,
  subFont: b.subFont,
  border: b.border,
  borderColor: b.borderColor,
  animate: b.animate,
  entrance: b.entrance,
  ...(nameTitle ? { boxOn: b.boxOn, size: b.size, align: b.align, x: b.x, y: b.y } : {}),
});

/** Has the event a look of its own (not the starting one)? */
export const hasBrand = (b: Brand | undefined): b is Brand => !!b && JSON.stringify({ ...b, fonts: [] }) !== JSON.stringify(defaultBrand());

const color = (c: string, d: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : d);
const within = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

/** Keep a look in range (mirrors Brand::cleaned). */
export function cleanBrand(brand: Brand): Brand {
  const d = defaultBrand();
  return {
    ...d,
    ...brand,
    font: brand.font.trim().slice(0, 60) || d.font,
    textColor: color(brand.textColor, d.textColor),
    accent: color(brand.accent, d.accent),
    boxColor: color(brand.boxColor, d.boxColor),
    outlineColor: color(brand.outlineColor, d.outlineColor),
    borderColor: color(brand.borderColor, d.borderColor),
    subColor: brand.subColor && /^#[0-9a-fA-F]{6}$/.test(brand.subColor) ? brand.subColor : '',
    subFont: brand.subFont.trim().slice(0, 60),
    boxOpacity: within(brand.boxOpacity, 0, 100, d.boxOpacity),
    size: within(brand.size, 12, 400, d.size),
    weight: Math.floor(within(brand.weight, 300, 900, d.weight) / 100) * 100,
    outline: within(brand.outline, 0, 20, 0),
    padding: within(brand.padding, 0, 120, d.padding),
    radius: within(brand.radius, 0, 60, d.radius),
    lineHeight: within(brand.lineHeight, 80, 300, d.lineHeight),
    letterSpacing: within(brand.letterSpacing, -10, 40, 0),
    subSize: within(brand.subSize, 20, 150, d.subSize),
    border: within(brand.border, 0, 20, 0),
    x: within(brand.x, 0, 45, d.x),
    y: within(brand.y, 0, 90, d.y),
    fonts: brand.fonts
      .slice(0, 40)
      .map((f) => ({
        name: [...f.name.trim()]
          .filter((c) => c >= ' ' && c !== '"')
          .slice(0, 60)
          .join(''),
        path: f.path,
      }))
      .filter((f) => f.name && f.path.trim()),
  };
}

/** Put the look on every title, song and scoreboard (the demo engine's ApplyBrand). */
export function applyBrand(s: Show, brand: Brand): void {
  const b = cleanBrand(brand);
  for (const src of s.sources) {
    const k = src.kind;
    if (k.type === 'text') k.style = branded(k.style, b, k.layout === 'lowerThird');
    else if (k.type === 'lyrics') k.style = { ...k.style, font: b.font, color: b.textColor };
    else if (k.type === 'scoreboard') k.home.color = b.accent;
  }
  s.event.brand = b;
}
