// Small helpers for the interface.

import { sampleGradient, type Gradient } from '../core/gradient';
import { hex } from '../core/color';

/** A CSS gradient that looks like a Gradient (sampled, alpha included). */
export function gradientCss(g: Gradient, reverse = false): string {
  const parts: string[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const c = sampleGradient(g, reverse ? 1 - t : t);
    const h = hex(c);
    const a = c[3];
    parts.push(`rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a.toFixed(3)}) ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

/** The checkerboard behind see-through colors. */
export const CHECKER_CSS = 'repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%) 50% / 10px 10px';
