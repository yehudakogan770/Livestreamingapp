// The animatable properties of a layer, addressed by a path
// ("transform.position", "reveal.left", "animators.0.start"…), so the
// timeline, the graph editor and the property panel all edit them the same way.

import { isAnimated } from '../core/easing';
import type { Layer, Prop, Value, Vec2 } from '../core/types';

export interface PropInfo {
  path: string;
  label: string;
  /** 1 number, or a point. */
  dims: 1 | 2;
  fallback: Value;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}

const T: PropInfo[] = [
  { path: 'transform.anchor', label: 'Anchor point', dims: 2, fallback: [0, 0], unit: 'px' },
  { path: 'transform.position', label: 'Position', dims: 2, fallback: [0, 0], unit: 'px' },
  { path: 'transform.scale', label: 'Scale', dims: 2, fallback: [100, 100], unit: '%' },
  { path: 'transform.rotation', label: 'Rotation', dims: 1, fallback: 0, unit: '°' },
  { path: 'transform.opacity', label: 'Opacity', dims: 1, fallback: 100, unit: '%', min: 0, max: 100 },
];

const REVEAL: PropInfo[] = [
  { path: 'reveal.left', label: 'Wipe left', dims: 1, fallback: 0, unit: '%', min: 0, max: 100 },
  { path: 'reveal.right', label: 'Wipe right', dims: 1, fallback: 0, unit: '%', min: 0, max: 100 },
  { path: 'reveal.top', label: 'Wipe top', dims: 1, fallback: 0, unit: '%', min: 0, max: 100 },
  { path: 'reveal.bottom', label: 'Wipe bottom', dims: 1, fallback: 0, unit: '%', min: 0, max: 100 },
];

/** Every property of a layer that can have keyframes, in display order. */
export function propsOf(l: Layer): PropInfo[] {
  const out = [...T];
  if (l.type === 'shape') {
    if (l.shape !== 'path') out.push({ path: 'size', label: 'Size', dims: 2, fallback: [100, 100], unit: 'px', min: 0 });
    if (l.shape === 'rect') out.push({ path: 'roundness', label: 'Corner radius', dims: 1, fallback: 0, unit: 'px', min: 0 });
    if (l.trim) {
      out.push({ path: 'trim.start', label: 'Trim start', dims: 1, fallback: 0, unit: '%', min: 0, max: 100 });
      out.push({ path: 'trim.end', label: 'Trim end', dims: 1, fallback: 100, unit: '%', min: 0, max: 100 });
      out.push({ path: 'trim.offset', label: 'Trim offset', dims: 1, fallback: 0, unit: '%' });
    }
  }
  if (l.reveal) out.push(...REVEAL);
  out.push({ path: 'blur', label: 'Blur', dims: 1, fallback: 0, unit: 'px', min: 0 });
  if (l.type === 'text')
    (l.animators ?? []).forEach((a, i) => {
      const n = a.name || `Animator ${i + 1}`;
      out.push({ path: `animators.${i}.start`, label: `${n}: start`, dims: 1, fallback: 0, unit: '%' });
      out.push({ path: `animators.${i}.end`, label: `${n}: end`, dims: 1, fallback: 100, unit: '%' });
      out.push({ path: `animators.${i}.offset`, label: `${n}: offset`, dims: 1, fallback: 0, unit: '%' });
      if (a.opacity) out.push({ path: `animators.${i}.opacity`, label: `${n}: opacity`, dims: 1, fallback: 100, unit: '%' });
      if (a.position) out.push({ path: `animators.${i}.position`, label: `${n}: position`, dims: 2, fallback: [0, 0], unit: 'px' });
      if (a.scale) out.push({ path: `animators.${i}.scale`, label: `${n}: scale`, dims: 1, fallback: 100, unit: '%' });
      if (a.rotation) out.push({ path: `animators.${i}.rotation`, label: `${n}: rotation`, dims: 1, fallback: 0, unit: '°' });
      if (a.blur) out.push({ path: `animators.${i}.blur`, label: `${n}: blur`, dims: 1, fallback: 0, unit: 'px' });
    });
  (l.masks ?? []).forEach((m, i) => {
    out.push({ path: `masks.${i}.feather`, label: `${m.name}: feather`, dims: 1, fallback: 0, unit: 'px', min: 0 });
    out.push({ path: `masks.${i}.opacity`, label: `${m.name}: opacity`, dims: 1, fallback: 100, unit: '%', min: 0, max: 100 });
  });
  (l.effects ?? []).forEach((e, i) => {
    const name = EFFECT_NAMES[e.type];
    if (e.type === 'dropShadow') {
      out.push({ path: `effects.${i}.opacity`, label: `${name}: opacity`, dims: 1, fallback: 60, unit: '%' });
      out.push({ path: `effects.${i}.distance`, label: `${name}: distance`, dims: 1, fallback: 6, unit: 'px' });
      out.push({ path: `effects.${i}.softness`, label: `${name}: softness`, dims: 1, fallback: 10, unit: 'px' });
    } else if (e.type === 'glow') {
      out.push({ path: `effects.${i}.opacity`, label: `${name}: opacity`, dims: 1, fallback: 50, unit: '%' });
      out.push({ path: `effects.${i}.radius`, label: `${name}: radius`, dims: 1, fallback: 12, unit: 'px' });
    } else if (e.type === 'blur') out.push({ path: `effects.${i}.amount`, label: `${name}: amount`, dims: 1, fallback: 4, unit: 'px' });
    else if (e.type === 'stroke') {
      out.push({ path: `effects.${i}.width`, label: `${name}: width`, dims: 1, fallback: 3, unit: 'px' });
      out.push({ path: `effects.${i}.opacity`, label: `${name}: opacity`, dims: 1, fallback: 100, unit: '%' });
    } else if (e.type === 'gradient') out.push({ path: `effects.${i}.opacity`, label: `${name}: opacity`, dims: 1, fallback: 100, unit: '%' });
    else if (e.type === 'noise') out.push({ path: `effects.${i}.amount`, label: `${name}: amount`, dims: 1, fallback: 10, unit: '%' });
    else if (e.type === 'color')
      for (const k of ['brightness', 'contrast', 'saturation'] as const) out.push({ path: `effects.${i}.${k}`, label: `${name}: ${k}`, dims: 1, fallback: 0 });
  });
  return out;
}

export const EFFECT_NAMES: Record<string, string> = {
  dropShadow: 'Drop shadow',
  glow: 'Glow',
  blur: 'Blur',
  fill: 'Color fill',
  stroke: 'Outline',
  gradient: 'Gradient overlay',
  noise: 'Grain',
  color: 'Color correction',
};

/** A property by path (undefined when the layer has none there yet). */
export function getProp(l: Layer, path: string): Prop<Value> | undefined {
  let o: unknown = l;
  for (const part of path.split('.')) {
    if (o === null || o === undefined) return undefined;
    o = (o as Record<string, unknown>)[part];
  }
  return o as Prop<Value> | undefined;
}

/** A copy of the layer with the property at `path` replaced (parents made as needed). */
export function withProp(l: Layer, path: string, p: Prop<Value>): Layer {
  const parts = path.split('.');
  const copy = { ...l } as Record<string, unknown>;
  let o = copy;
  for (let n = 0; n < parts.length - 1; n++) {
    const k = parts[n]!;
    const cur = o[k];
    let next: Record<string, unknown>;
    if (Array.isArray(cur)) next = [...cur] as unknown as Record<string, unknown>;
    else if (cur && typeof cur === 'object') next = { ...(cur as Record<string, unknown>) };
    else next = k === 'reveal' ? { left: { v: 0 }, right: { v: 0 }, top: { v: 0 }, bottom: { v: 0 } } : {};
    o[k] = next;
    o = next;
  }
  o[parts[parts.length - 1]!] = p;
  return copy as unknown as Layer;
}

/** Which properties of a layer have keyframes. */
export const animatedProps = (l: Layer) => propsOf(l).filter((pi) => isAnimated(getProp(l, pi.path)));

/** Every key time of a layer (for the collapsed layer row). */
export function layerKeyTimes(l: Layer): number[] {
  const out = new Set<number>();
  for (const pi of propsOf(l)) {
    const p = getProp(l, pi.path);
    if (isAnimated(p)) for (const k of p.k) out.add(Math.round(k.t * 1000) / 1000);
  }
  return [...out].sort((a, b) => a - b);
}

export const isVec = (v: Value): v is Vec2 => Array.isArray(v);
