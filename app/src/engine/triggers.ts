// Triggers (mirrors crates/engine/src/triggers.rs): which go off between two
// versions of the show.

import type { Show } from './types/Show';
import type { ScreenId } from './types/ScreenId';
import { sourceEnded } from './timing';

const onAir = (s: Show, id: string, screen: ScreenId | null) =>
  (screen === 'live' ? ['live'] : screen === 'back' ? ['back'] : ['live', 'back']).some((sc) => s.screens[sc as 'live' | 'back'].program === id);

const countdownFired = (s: Show, id: string) => {
  const k = s.sources.find((x) => x.id === id)?.kind;
  return k?.type === 'countdown' && k.timer.fired;
};

const minuteOfDay = (now: number, offset: number) => (((Math.floor(now / 60000) + offset) % 1440) + 1440) % 1440;

export function triggersDue(before: Show, after: Show, now: number): number[] {
  const out: number[] = [];
  after.triggers.forEach((t, i) => {
    if (!t.enabled) return;
    const w = t.when;
    let hit = false;
    if (w.type === 'onAir') hit = !onAir(before, w.sourceId, w.screen) && onAir(after, w.sourceId, w.screen);
    else if (w.type === 'offAir') hit = onAir(before, w.sourceId, w.screen) && !onAir(after, w.sourceId, w.screen);
    else if (w.type === 'countdownZero') hit = !countdownFired(before, w.sourceId) && countdownFired(after, w.sourceId);
    else if (w.type === 'videoEnds') {
      const src = after.sources.find((x) => x.id === w.sourceId);
      hit = !!src && src.kind.type === 'video' && t.lastFired < Math.max(1, src.kind.playback.at) && sourceEnded(src, now);
    } else if (w.type === 'atTime') hit = minuteOfDay(now, w.utcOffsetMin) === w.minute && now - t.lastFired > 90_000;
    if (hit) out.push(i);
  });
  return out;
}
