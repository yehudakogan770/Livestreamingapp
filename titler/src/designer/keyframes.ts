// Moving animation around: keyframes copied from one layer and pasted on
// others at the playhead, a layer's whole animation saved as a preset (kept
// in this browser) and given to other layers, and staggering (each selected
// layer's animation a few frames after the one before).

import { isAnimated } from '../core/easing';
import type { Keyframe, Layer, TitleProject, Value } from '../core/types';
import { flatLayers, updateLayers } from './ops';
import { getProp, propsOf, withProp } from './props';
import type { KeyRef } from './store';

/** Keyframes taken from a layer: each property's keys, timed from the earliest one. */
export interface KeyClip {
  items: { path: string; keys: Keyframe<Value>[] }[];
}

/** Copy keyframes (the ones selected; or every key of the layer's animated properties). */
export function copyKeys(layer: Layer, refs?: KeyRef[]): KeyClip | null {
  const items: KeyClip['items'] = [];
  for (const pi of propsOf(layer)) {
    const p = getProp(layer, pi.path);
    if (!isAnimated(p)) continue;
    const keys = refs ? p.k.filter((k) => refs.some((r) => r.layer === layer.id && r.path === pi.path && Math.abs(r.t - k.t) < 1e-6)) : p.k;
    if (keys.length) items.push({ path: pi.path, keys: keys.map((k) => ({ ...k })) });
  }
  if (!items.length) return null;
  const t0 = Math.min(...items.flatMap((x) => x.keys.map((k) => k.t)));
  return { items: items.map((x) => ({ ...x, keys: x.keys.map((k) => ({ ...k, t: k.t - t0 })) })) };
}

/** Put copied keyframes on a layer from time `at` (properties it doesn't have are left out). */
export function pasteKeysOn(layer: Layer, clip: KeyClip, at: number): Layer {
  const has = new Set(propsOf(layer).map((p) => p.path));
  let out = layer;
  for (const item of clip.items) {
    if (!has.has(item.path)) continue;
    const p = getProp(out, item.path);
    const placed = item.keys.map((k) => ({ ...k, t: Math.max(0, k.t + at) }));
    const kept = isAnimated(p) ? p.k.filter((k) => !placed.some((n) => Math.abs(n.t - k.t) < 1e-6)) : [];
    const keys = [...kept, ...placed].sort((a, b) => a.t - b.t);
    out = withProp(out, item.path, { k: keys, ...(p?.x ? { x: p.x } : {}) });
  }
  return out;
}

export function pasteKeys(p: TitleProject, compId: string, ids: string[], clip: KeyClip, at: number): TitleProject {
  return updateLayers(p, compId, ids, (l) => pasteKeysOn(l, clip, at));
}

/** Every keyframe of a layer moved by dt seconds. */
export function shiftKeys(layer: Layer, dt: number): Layer {
  let out = layer;
  for (const pi of propsOf(layer)) {
    const p = getProp(out, pi.path);
    if (!isAnimated(p)) continue;
    out = withProp(out, pi.path, { k: p.k.map((k) => ({ ...k, t: Math.max(0, k.t + dt) })), ...(p.x ? { x: p.x } : {}) });
  }
  return out;
}

/**
 * Stagger: the layers in the order given, each one's animation `step`
 * seconds after the one before (the first stays). With `bars`, the layer
 * bars move too.
 */
export function stagger(p: TitleProject, compId: string, ids: string[], step: number, bars = false): TitleProject {
  let out = p;
  ids.forEach((id, i) => {
    if (!i) return;
    const dt = step * i;
    out = updateLayers(out, compId, [id], (l) => {
      const moved = shiftKeys(l, dt);
      return bars ? { ...moved, start: Math.max(0, l.start + dt), end: l.end + dt } : moved;
    });
  });
  return out;
}

/** The selected layers in the order they are stacked in (top first). */
export function inStackOrder(p: TitleProject, compId: string, ids: string[]): string[] {
  const c = p.compositions.find((x) => x.id === compId);
  if (!c) return ids;
  return flatLayers(c.layers)
    .map((l) => l.id)
    .filter((id) => ids.includes(id));
}

// ---- animation presets ----

export interface AnimPreset {
  id: string;
  name: string;
  clip: KeyClip;
}

const KEY = 'lumora-titler-anim-presets';

export function loadAnimPresets(): AnimPreset[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as AnimPreset[];
    return Array.isArray(list) ? list.filter((x) => x && x.id && x.clip?.items) : [];
  } catch {
    return [];
  }
}

function keep(list: AnimPreset[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 100)));
  } catch {
    // Not kept (private window, full).
  }
}

/** Save a layer's animation as a preset (null when it has none). */
export function saveAnimPreset(layer: Layer, name: string): AnimPreset | null {
  const clip = copyKeys(layer);
  if (!clip) return null;
  const preset = { id: `ap${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim() || layer.name, clip };
  keep([preset, ...loadAnimPresets()]);
  return preset;
}

export function removeAnimPreset(id: string): AnimPreset[] {
  const list = loadAnimPresets().filter((x) => x.id !== id);
  keep(list);
  return list;
}
