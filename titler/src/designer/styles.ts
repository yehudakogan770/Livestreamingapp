// Layer styles: the look of a layer (not its words, place or animation),
// kept on this computer and applied to other layers of the same kind.

import type { Layer } from '../core/types';
import { uid } from '../core/build';

export interface LayerStyle {
  id: string;
  name: string;
  kind: Layer['type'];
  /** The parts of the layer that make its look. */
  look: Record<string, unknown>;
}

const KEY = 'lumora-titler-styles';

/** The look of a layer, or null for kinds with nothing to keep. */
export function styleOf(l: Layer): LayerStyle | null {
  const look: Record<string, unknown> = { effects: l.effects ?? [], blend: l.blend ?? 'normal' };
  if (l.type === 'text') Object.assign(look, { style: l.style });
  else if (l.type === 'shape') Object.assign(look, { fill: l.fill, stroke: l.stroke, roundness: l.roundness });
  else if (l.type !== 'image' && l.type !== 'video') return null;
  return { id: uid('s'), name: '', kind: l.type, look: JSON.parse(JSON.stringify(look)) as Record<string, unknown> };
}

export function applyStyle(l: Layer, s: LayerStyle): Layer {
  if (l.type !== s.kind) return l;
  return { ...l, ...(JSON.parse(JSON.stringify(s.look)) as object) } as Layer;
}

export function loadStyles(): LayerStyle[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as LayerStyle[]) : [];
  } catch {
    return [];
  }
}

function write(list: LayerStyle[]): LayerStyle[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* kept for this session only */
  }
  return list;
}

export const saveStyle = (s: LayerStyle) => write([...loadStyles(), s]);
export const removeStyle = (id: string) => write(loadStyles().filter((s) => s.id !== id));
