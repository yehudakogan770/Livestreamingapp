// Every filter, by id; running one (whole, or split into overlapping bands
// for the workers) and running a smart object's filter list.

import type { FilterContext, FilterDef, Params } from './types';
import { defaults } from './types';
import { BLUR_FILTERS } from './blur';
import { SHARPEN_NOISE_FILTERS } from './sharpenNoise';
import { STYLIZE_FILTERS } from './stylize';
import { DISTORT_FILTERS } from './distort';
import { ADJUST_FILTERS } from './adjustFilters';
import { DEVELOP_FILTER } from './develop';
import { compositePixel } from '../blend';
import type { Img } from '../img';
import type { SmartFilter } from '../smartFilters';

export const FILTERS: FilterDef[] = [...BLUR_FILTERS, ...SHARPEN_NOISE_FILTERS, ...STYLIZE_FILTERS, ...DISTORT_FILTERS, ...ADJUST_FILTERS, DEVELOP_FILTER];

const byId = new Map(FILTERS.map((f) => [f.id, f]));

export function filterById(id: string): FilterDef | undefined {
  return byId.get(id);
}

/** Filter menu order. */
export const FILTER_MENUS = ['Blur', 'Blur Gallery', 'Distort', 'Noise', 'Pixelate', 'Render', 'Sharpen', 'Stylize', 'Other'];

export function runFilter(id: string, img: Img, params: Params | undefined, ctx: FilterContext): Img {
  const f = byId.get(id);
  if (!f) throw new Error(`Unknown filter “${id}”.`);
  return f.run(img, { ...defaults(f), ...params }, ctx);
}

/** Bands for splitting a filter across workers: [y0, y1) with `pad` rows of overlap. */
export function bands(h: number, count: number, pad: number): { y0: number; y1: number; r0: number; r1: number }[] {
  const out: { y0: number; y1: number; r0: number; r1: number }[] = [];
  const step = Math.ceil(h / count);
  for (let y = 0; y < h; y += step) {
    const y1 = Math.min(h, y + step);
    out.push({ y0: y, y1, r0: Math.max(0, y - pad), r1: Math.min(h, y1 + pad) });
  }
  return out;
}

/** A smart object's filters, bottom to top, each mixed in by its own mode and opacity. */
export function runFilterChain(img: Img, filters: SmartFilter[], ctx: FilterContext): Img {
  let cur = img;
  for (const sf of filters) {
    if (!sf.visible) continue;
    const def = byId.get(sf.filter);
    if (!def) continue;
    const res = def.run(cur, { ...defaults(def), ...sf.params }, ctx);
    if (sf.blend === 'normal' && sf.opacity >= 1) {
      cur = res;
      continue;
    }
    const mixed = { ...cur, data: cur.data.slice() };
    for (let i = 0; i < mixed.data.length; i += 4) {
      // The filtered result over the input with the filter's blending options.
      const a = res.data[i + 3]! * sf.opacity;
      compositePixel(sf.blend, mixed.data, i, res.data[i]!, res.data[i + 1]!, res.data[i + 2]!, a, (i / 4) % img.w, Math.floor(i / 4 / img.w));
    }
    cur = mixed;
  }
  return cur;
}
