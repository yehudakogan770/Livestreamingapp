// A stage visuals scene playing gently behind a 3D logo.

import type { SceneRef } from '../engine/types/SceneRef';
import type { Visuals } from '../engine/types/Visuals';
import { defaultVisuals } from '../engine/visuals';

/** The loops offered behind a logo (named as in the design). */
export const LOOPS: { name: string; scene: SceneRef }[] = [
  { name: 'Aurora', scene: { bank: 0, scene: 0 } },
  { name: 'Bokeh', scene: { bank: 0, scene: 1 } },
  { name: 'Stars', scene: { bank: 0, scene: 3 } },
  { name: 'Warm glow', scene: { bank: 5, scene: 0 } },
  { name: 'Galaxy', scene: { bank: 12, scene: 1 } },
  { name: 'Soft clouds', scene: { bank: 0, scene: 6 } },
  { name: 'Heaven light', scene: { bank: 6, scene: 1 } },
  { name: 'Particles', scene: { bank: 0, scene: 20 } },
];

const cache = new Map<string, Visuals>();
/** A calm visuals state that shows one scene (no flashes). */
export function loopVisuals(scene: SceneRef): Visuals {
  const key = `${scene.bank}:${scene.scene}`;
  let v = cache.get(key);
  if (!v) {
    const d = defaultVisuals();
    v = { ...d, bpm: 70, scene, settings: { ...d.settings, flashEvery: 0, flash: 0, speed: 0.6 } };
    cache.set(key, v);
  }
  return v;
}
