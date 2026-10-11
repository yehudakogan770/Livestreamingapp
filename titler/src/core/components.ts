// Components: a composition placed several times, each copy with its own
// changes to the layers inside it (overrides): other words, another color or
// picture, hidden, moved, scaled, turned or faded. Moves and the like are
// added to the layer's own animation, so its IN and OUT still play.

import type { Composition, Layer, LayerOverride, Prop, Value, Vec2 } from './types';

const isObj = (o: unknown): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o);

/** Every key of a property's values changed by `fn` (a still value or each keyframe). */
function mapProp<T extends Value>(p: Prop<T>, fn: (v: T) => T): Prop<T> {
  if (p.k) return { ...p, k: p.k.map((k) => ({ ...k, v: fn(k.v) })) };
  return { ...p, v: fn(p.v as T) };
}

/** A layer with a copy's changes. */
export function overrideLayer(l: Layer, o: LayerOverride | undefined): Layer {
  if (!isObj(o)) return l;
  let out: Layer = l;
  if (typeof o.visible === 'boolean') out = { ...out, visible: o.visible };
  if (typeof o.text === 'string' && out.type === 'text') out = { ...out, text: o.text };
  if (typeof o.fill === 'string' && o.fill) {
    if (out.type === 'text') out = { ...out, style: { ...out.style, fill: { type: 'solid', color: o.fill } } };
    else if (out.type === 'shape' && out.fill) out = { ...out, fill: { type: 'solid', color: o.fill } };
  }
  if (typeof o.picture === 'string' && o.picture && (out.type === 'image' || out.type === 'video')) out = { ...out, asset: o.picture };
  const tr = { ...out.transform };
  let moved = false;
  if (Array.isArray(o.move) && (o.move[0] || o.move[1])) {
    const [dx, dy] = o.move;
    tr.position = mapProp<Vec2>(tr.position, (v) => [v[0] + (Number(dx) || 0), v[1] + (Number(dy) || 0)]);
    moved = true;
  }
  if (typeof o.scale === 'number' && o.scale !== 100) {
    const k = o.scale / 100;
    tr.scale = mapProp<Vec2>(tr.scale, (v) => [v[0] * k, v[1] * k]);
    moved = true;
  }
  if (typeof o.rotate === 'number' && o.rotate) {
    tr.rotation = mapProp<number>(tr.rotation, (v) => v + (o.rotate as number));
    moved = true;
  }
  if (typeof o.opacity === 'number' && o.opacity !== 100) {
    const k = Math.max(0, o.opacity) / 100;
    tr.opacity = mapProp<number>(tr.opacity, (v) => v * k);
    moved = true;
  }
  return moved ? { ...out, transform: tr } : out;
}

const cache = new WeakMap<Composition, WeakMap<object, Composition>>();

/** The composition as a copy shows it (the same object when it changes nothing). */
export function withOverrides(c: Composition, overrides: Record<string, LayerOverride> | null | undefined): Composition {
  if (!isObj(overrides) || !Object.keys(overrides).length) return c;
  let per = cache.get(c);
  if (!per) cache.set(c, (per = new WeakMap()));
  const hit = per.get(overrides);
  if (hit) return hit;
  const walk = (ls: Layer[]): Layer[] =>
    ls.map((l) => {
      const x = overrideLayer(l, overrides[l.id]);
      return x.type === 'group' ? { ...x, children: walk(x.children) } : x;
    });
  const out = { ...c, layers: walk(c.layers) };
  per.set(overrides, out);
  return out;
}

/** Does an override change anything? */
export const overrides = (o: LayerOverride | undefined): boolean =>
  !!o &&
  (typeof o.visible === 'boolean' ||
    typeof o.text === 'string' ||
    !!o.fill ||
    !!o.picture ||
    !!(o.move && (o.move[0] || o.move[1])) ||
    (typeof o.scale === 'number' && o.scale !== 100) ||
    !!o.rotate ||
    (typeof o.opacity === 'number' && o.opacity !== 100));
