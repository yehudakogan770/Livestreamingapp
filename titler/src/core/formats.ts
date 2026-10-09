// Formats: one template in several shapes (16:9, 9:16 for vertical streams,
// 1:1, 4K). A format is a composition made from the main one: its layers
// re-placed by their constraints (pinned to an edge or the middle, scaled,
// or stretched like Figma's), then its own to adjust. On air the renderer
// picks the format whose shape is closest to the picture it draws into.

import { uid } from './build';
import type { Composition, Constraints, Keyframe, Layer, Prop, TitleProject, Vec2 } from './types';

export const FORMAT_PRESETS: { name: string; w: number; h: number }[] = [
  { name: '16:9', w: 1920, h: 1080 },
  { name: '9:16 vertical', w: 1080, h: 1920 },
  { name: '1:1 square', w: 1080, h: 1080 },
  { name: '4:5 portrait', w: 1080, h: 1350 },
  { name: '4K', w: 3840, h: 2160 },
];

/** The compositions that are formats of the main one (the main one first). */
export function formatsOf(p: TitleProject): Composition[] {
  const main = p.compositions.find((c) => c.id === p.main);
  if (!main) return [];
  return [main, ...p.compositions.filter((c) => c.variantOf === main.id)];
}

/** The format whose shape is closest to w × h (the main one when they tie). */
export function pickFormat(p: TitleProject, w: number, h: number): Composition | undefined {
  const list = formatsOf(p);
  if (list.length < 2 || !(w > 0) || !(h > 0)) return list[0];
  const want = Math.log(w / h);
  let best = list[0]!;
  let gap = Math.abs(Math.log(best.width / best.height) - want);
  for (const c of list.slice(1)) {
    const g = Math.abs(Math.log(c.width / c.height) - want);
    if (g < gap - 1e-6) {
      best = c;
      gap = g;
    }
  }
  return best;
}

/**
 * A layer's constraints: as set, else automatic: a layer more than half the
 * frame wide (a banner, a ticker) stretches with it, the others are pinned
 * to the edge (or the middle) they are nearest; the same down.
 */
export function constraintsOf(l: Layer, center: Vec2, w: number, h: number, size: Vec2 = [0, 0]): Required<Constraints> {
  const third = (v: number, s: number) => (v < s / 3 ? 0 : v > (s * 2) / 3 ? 2 : 1);
  return {
    h: l.constraints?.h ?? (size[0] > w / 2 ? 'stretch' : (['left', 'center', 'right'] as const)[third(center[0], w)]),
    v: l.constraints?.v ?? (size[1] > h / 2 ? 'stretch' : (['top', 'center', 'bottom'] as const)[third(center[1], h)]),
  };
}

const mapVec = (p: Prop<Vec2>, f: (v: Vec2) => Vec2, tangent?: (v: Vec2) => Vec2): Prop<Vec2> => {
  if (p.k)
    return {
      ...p,
      k: p.k.map((k: Keyframe<Vec2>) => ({
        ...k,
        v: f(k.v),
        ...(tangent && k.so ? { so: tangent(k.so) } : {}),
        ...(tangent && k.si ? { si: tangent(k.si) } : {}),
      })),
    };
  return { ...p, v: f(p.v as Vec2) };
};

const first = (p: Prop<Vec2>): Vec2 => (p.k ? (p.k[0]?.v ?? [0, 0]) : (p.v as Vec2));

/** A layer's box size (for its center and stretching), when it has one. */
function sizeOf(l: Layer): Vec2 {
  if (l.type === 'text') return l.box;
  if (l.type === 'shape') return l.size.k ? (l.size.k[0]?.v ?? [0, 0]) : (l.size.v as Vec2);
  if (l.type === 'image' || l.type === 'video') return l.size;
  return [0, 0];
}

/**
 * Re-place one top-level layer from a fromW × fromH frame into toW × toH:
 * everything scales with the short side first (1080p → 4K doubles), then
 * the layer moves with the edge or middle it is pinned to, or scales, or
 * stretches (its box grows by the difference).
 */
export function adaptLayer(l: Layer, fromW: number, fromH: number, toW: number, toH: number): Layer {
  const k = Math.min(toW, toH) / Math.min(fromW, fromH);
  const dw = toW - fromW * k;
  const dh = toH - fromH * k;
  const pos = first(l.transform.position);
  const anchor = first(l.transform.anchor);
  const size = sizeOf(l);
  const center: Vec2 = [pos[0] - anchor[0] + size[0] / 2, pos[1] - anchor[1] + size[1] / 2];
  const c = constraintsOf(l, center, fromW, fromH, size);
  const sx = toW / (fromW * k);
  const sy = toH / (fromH * k);
  const moveX = (x: number) => (c.h === 'right' ? x + dw : c.h === 'center' ? x + dw / 2 : c.h === 'scale' ? x * sx : x);
  const moveY = (y: number) => (c.v === 'bottom' ? y + dh : c.v === 'center' ? y + dh / 2 : c.v === 'scale' ? y * sy : y);
  let out: Layer = {
    ...l,
    transform: {
      ...l.transform,
      position: mapVec(
        l.transform.position,
        (v) => [moveX(v[0] * k), moveY(v[1] * k)],
        (t) => [t[0] * k, t[1] * k],
      ),
      scale: k === 1 ? l.transform.scale : mapVec(l.transform.scale, (v) => [v[0] * k, v[1] * k]),
    },
  };
  // Stretched: the box grows (shapes and text boxes), its left/top edge stays.
  const grow: Vec2 = [c.h === 'stretch' ? dw / k : 0, c.v === 'stretch' ? dh / k : 0];
  if (grow[0] || grow[1]) {
    if (out.type === 'shape') out = { ...out, size: mapVec(out.size, (v) => [Math.max(0, v[0] + grow[0]), Math.max(0, v[1] + grow[1])]) };
    else if (out.type === 'text')
      out = { ...out, box: [out.box[0] ? Math.max(0, out.box[0] + grow[0]) : 0, out.box[1] ? Math.max(0, out.box[1] + grow[1]) : 0] };
    else if (out.type === 'image' || out.type === 'video') out = { ...out, size: [Math.max(0, out.size[0] + grow[0]), Math.max(0, out.size[1] + grow[1])] };
  }
  return out;
}

/** A composition re-made at another size (layers parented to others move with them). */
export function adaptComp(c: Composition, toW: number, toH: number): Composition {
  return {
    ...c,
    width: toW,
    height: toH,
    layers: c.layers.map((l) => (l.parent ? l : adaptLayer(l, c.width, c.height, toW, toH))),
    guides: undefined,
  };
}

/** Make a format of the main composition (or remake one, keeping its id and name). */
export function makeFormat(p: TitleProject, name: string, w: number, h: number, replace?: string): { project: TitleProject; id: string } {
  const main = p.compositions.find((c) => c.id === p.main);
  if (!main) return { project: p, id: '' };
  const made = adaptComp(structuredClone(main), w, h);
  const old = replace ? p.compositions.find((c) => c.id === replace) : undefined;
  const comp: Composition = { ...made, id: old?.id ?? uid('c'), name: old?.name ?? `${main.name} (${name})`, variantOf: main.id };
  const compositions = old ? p.compositions.map((c) => (c.id === old.id ? comp : c)) : [...p.compositions, comp];
  return { project: { ...p, compositions }, id: comp.id };
}
