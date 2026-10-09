// The designer's preview plays audio cues as it goes: while playing (forward,
// at normal speed) a cue's sound starts when the playhead passes it, and the
// "take" preview plays the IN, loop and OUT cues as Lumora would on air.

import { useEffect } from 'react';
import { cueEvents, cueGain, straightCueEvents } from '../core/cues';
import type { Asset } from '../core/types';
import { compOf } from './ops';
import type { Store } from './store';

let shared: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  shared ??= new AudioContext({ latencyHint: 'interactive' });
  if (shared.state === 'suspended') void shared.resume().catch(() => {});
  return shared;
}

/** A sound asset decoded (once). */
export function decodeSound(ctx: BaseAudioContext, a: Asset, urlFor: (s: string) => string): Promise<AudioBuffer | null> {
  const key = `${a.id}|${a.src.length}|${a.src.slice(0, 120)}`;
  let p = buffers.get(key);
  if (!p) {
    const url = a.src.startsWith('data:') || a.src.startsWith('blob:') ? a.src : urlFor(a.src);
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .catch(() => null);
    buffers.set(key, p);
  }
  return p;
}

function play(a: Asset, gain: number, urlFor: (s: string) => string, late = 0) {
  const ctx = audio();
  if (!ctx) return;
  void decodeSound(ctx, a, urlFor).then((buf) => {
    if (!buf || late >= buf.duration) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(ctx.destination);
    src.start(ctx.currentTime, late);
  });
}

/** Play the cues the preview passes (mounted once by the designer). */
export function usePreviewCues(store: Store, urlFor: (s: string) => string): void {
  useEffect(() => {
    let raf = 0;
    let last: { t: number; now: number; cue: boolean; key: string } | null = null;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = store.get();
      const now = performance.now();
      if (!s.playing && !s.cue) {
        last = null;
        return;
      }
      const c = compOf(s.project, s.compId);
      if (!c.cues.some((q) => q.sound)) {
        last = null;
        return;
      }
      const key = s.cue ? `cue|${s.cue.inAt}|${s.cue.outAt}` : `play|${s.rate}`;
      if (s.cue) {
        if (last?.cue && last.key.startsWith(`cue|${s.cue.inAt}|`)) {
          for (const e of cueEvents(s.project, c, s.cue.inAt / 1000, s.cue.outAt === null ? null : s.cue.outAt / 1000, last.now / 1000, now / 1000))
            play(e.sound, cueGain(e.cue), urlFor, Math.max(0, now / 1000 - e.at));
        } else if (now - s.cue.inAt < 100) {
          // Just taken: cues at its very start.
          for (const e of cueEvents(s.project, c, s.cue.inAt / 1000, null, s.cue.inAt / 1000, now / 1000)) play(e.sound, cueGain(e.cue), urlFor);
        }
      } else if (last && !last.cue && last.key === key && s.rate === 1 && s.time >= last.t) {
        for (const e of straightCueEvents(s.project, c, last.t, s.time)) play(e.sound, cueGain(e.cue), urlFor, Math.max(0, s.time - last.t - e.at));
      }
      last = { t: s.time, now, cue: !!s.cue, key };
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [store, urlFor]);
}
