// Going through the cameras by itself (mirrors crates/engine/src/cameras.rs).

import type { Action } from './types/Action';
import type { AutoSwitch } from './types/AutoSwitch';
import type { CameraControls } from './types/CameraControls';
import type { Show } from './types/Show';

export function defaultAutoSwitch(): AutoSwitch {
  return { on: false, cameras: [], minS: 6, maxS: 10, random: false, mix: false, nextAt: 0, seed: 1 };
}

/** A small, steady mix-up (xorshift, 32-bit like the engine's). */
function roll(a: AutoSwitch): number {
  let x = a.seed >>> 0 || 1;
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  a.seed = x;
  return x;
}

export function schedule(a: AutoSwitch, now: number): void {
  const spread = Math.max(0, a.maxS - a.minS);
  const extra = spread === 0 ? 0 : roll(a) % (spread + 1);
  a.nextAt = now + (a.minS + extra) * 1000;
}

/** The camera after `current`. */
export function pick(a: AutoSwitch, current: string | null): string | null {
  const n = a.cameras.length;
  if (!n) return null;
  const at = current === null ? -1 : a.cameras.indexOf(current);
  let i: number;
  if (a.random && at >= 0 && n > 1) i = (at + 1 + (roll(a) % (n - 1))) % n;
  else if (a.random && at < 0) i = roll(a) % n;
  else i = at >= 0 ? (at + 1) % n : 0;
  return a.cameras[i] ?? null;
}

/** On, due, and one of its cameras on air (anything else on air holds it). */
export function switchDue(s: Show, now: number): boolean {
  const a = s.autoSwitch;
  const p = s.screens.live.program;
  return a.on && a.cameras.length >= 2 && now >= a.nextAt && p !== null && a.cameras.includes(p);
}

/** The switch to make now (the auto-switch is moved on), if one is due. */
export function switchAction(s: Show, now: number): Action | null {
  if (!switchDue(s, now)) return null;
  const a = s.autoSwitch;
  const next = pick(a, s.screens.live.program);
  if (!next) return null;
  schedule(a, now);
  return a.mix
    ? { type: 'playNow', screen: 'live', sourceId: next, transition: { kind: 'fade', durationMs: 600 } }
    : { type: 'cutTo', screen: 'live', sourceId: next };
}

export function repairAutoSwitch(a: AutoSwitch, s: Show): void {
  a.cameras = [...new Set(a.cameras.filter((id) => s.sources.some((x) => x.id === id)))].slice(0, 32);
  a.minS = Math.min(600, Math.max(2, Math.round(a.minS) || 2));
  a.maxS = Math.min(600, Math.max(a.minS, Math.round(a.maxS) || a.minS));
  if (a.cameras.length < 2) a.on = false;
}

const cleanValues = (v: CameraControls['values']) => {
  const seen = new Set<string>();
  return v
    .map((x) => ({ name: x.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 40), value: x.value }))
    .filter((x) => Number.isFinite(x.value) && x.name && !seen.has(x.name) && seen.add(x.name))
    .slice(0, 24);
};

export function repairControls(c: CameraControls): CameraControls {
  return {
    values: cleanValues(c.values),
    shots: c.shots.slice(0, 24).map((s) => ({ name: s.name.trim().slice(0, 40), values: cleanValues(s.values) })),
  };
}
