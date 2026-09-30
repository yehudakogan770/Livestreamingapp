// Designed graphics (mirrors crates/engine/src/graphic.rs): ready-made
// starting points and how each element comes in.

import type { Element } from './types/Element';
import type { ElementKind } from './types/ElementKind';
import type { Entrance } from './types/Entrance';
import type { Graphic } from './types/Graphic';

/** How long an element takes to come in, ms. */
export const ENTRANCE_MS = 450;

export function newElement(kind: ElementKind, id: number): Element {
  const base: Element = {
    id,
    kind,
    x: 10,
    y: 70,
    w: 40,
    h: 10,
    text: 'Text',
    font: 'Segoe UI',
    size: 5,
    weight: 700,
    italic: false,
    align: 'left',
    color: '#ffffff',
    radius: 0,
    opacity: 1,
    path: '',
    shadow: false,
    entrance: 'fade',
    delayMs: 0,
  };
  if (kind === 'box') return { ...base, text: '', color: '#2f80ed', x: 8, y: 72, w: 45, h: 12, radius: 1, opacity: 0.95 };
  if (kind === 'image') return { ...base, text: '', x: 80, y: 6, w: 14, h: 14 };
  return base;
}

type Part = Partial<Element> & { kind: ElementKind };

/** Starting points: each a list of elements. */
export const TEMPLATES: { name: string; parts: Part[] }[] = [
  {
    name: 'Name and title',
    parts: [
      { kind: 'box', x: 6, y: 73, w: 44, h: 9, color: '#11151c', opacity: 0.92, radius: 0.8, entrance: 'slideLeft' },
      { kind: 'box', x: 6, y: 73, w: 0.8, h: 15, color: '#f2b233', entrance: 'rise' },
      { kind: 'text', x: 8, y: 73.5, w: 41, h: 8, text: 'Speaker name', size: 5, entrance: 'slideLeft', delayMs: 150 },
      { kind: 'box', x: 6, y: 82, w: 34, h: 6, color: '#2f80ed', opacity: 0.95, radius: 0.8, entrance: 'slideLeft', delayMs: 100 },
      { kind: 'text', x: 8, y: 82.2, w: 31, h: 5.6, text: 'Title or role', size: 3, weight: 500, entrance: 'fade', delayMs: 300 },
    ],
  },
  {
    name: 'Centre title',
    parts: [
      { kind: 'box', x: 20, y: 38, w: 60, h: 24, color: '#000000', opacity: 0.6, radius: 2, entrance: 'grow' },
      { kind: 'text', x: 22, y: 40, w: 56, h: 12, text: 'Welcome', size: 9, align: 'center', weight: 800, shadow: true, entrance: 'rise', delayMs: 150 },
      {
        kind: 'text',
        x: 22,
        y: 52,
        w: 56,
        h: 8,
        text: 'The annual dinner',
        size: 4,
        align: 'center',
        weight: 400,
        color: '#f2d27a',
        entrance: 'fade',
        delayMs: 350,
      },
    ],
  },
  {
    name: 'Corner bug',
    parts: [
      { kind: 'box', x: 76, y: 5, w: 20, h: 7, color: '#c7372f', radius: 3.5, entrance: 'grow' },
      { kind: 'text', x: 76, y: 5, w: 20, h: 7, text: '● LIVE', size: 3.6, align: 'center', weight: 800, entrance: 'fade', delayMs: 150 },
    ],
  },
  {
    name: 'Bottom band',
    parts: [
      { kind: 'box', x: 0, y: 86, w: 100, h: 9, color: '#0b2545', opacity: 0.92, entrance: 'rise' },
      { kind: 'box', x: 0, y: 86, w: 100, h: 0.5, color: '#f2b233', entrance: 'fade' },
      { kind: 'text', x: 3, y: 86, w: 94, h: 9, text: 'Please silence your phones', size: 4, weight: 600, entrance: 'fade', delayMs: 200 },
    ],
  },
];

export function fromTemplate(i: number): Graphic {
  const parts = TEMPLATES[i]?.parts ?? [];
  const elements = parts.map((p, n) => ({ ...newElement(p.kind, n + 1), ...p, id: n + 1 }));
  return { elements, nextId: elements.length };
}

/** An element's look while it comes in: t is ms since the graphic started. */
export function entranceAt(e: { entrance: Entrance; delayMs: number }, t: number): { alpha: number; dx: number; dy: number; scale: number } {
  if (e.entrance === 'none') return { alpha: 1, dx: 0, dy: 0, scale: 1 };
  const p = Math.min(1, Math.max(0, (t - e.delayMs) / ENTRANCE_MS));
  const k = 1 - (1 - p) ** 3;
  return {
    alpha: k,
    dx: e.entrance === 'slideLeft' ? -(1 - k) * 10 : 0,
    dy: e.entrance === 'rise' ? (1 - k) * 5 : 0,
    scale: e.entrance === 'grow' ? 0.6 + 0.4 * k : 1,
  };
}

/** The time until every element is in. */
export const settleMs = (g: Graphic) => Math.max(0, ...g.elements.map((e) => (e.entrance === 'none' ? 0 : e.delayMs + ENTRANCE_MS)));
