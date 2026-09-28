import type { Source } from './types/Source';
import { sourcePosition } from './timing';

/**
 * Keep a video or sound element on the engine's clock. Small drift is
 * corrected by playing very slightly faster or slower (inaudible, no jump);
 * only a big difference (a seek, a stall) jumps. So pictures in every window
 * and the sound in the control window stay in step.
 */
export function syncMedia(el: HTMLMediaElement, src: Source, now: number): void {
  if (src.kind.type !== 'video' || el.readyState < 1) return;
  const { durationS, playback } = src.kind;
  const want = sourcePosition(src, now);
  const playing = playback.playing && !(durationS > 0 && !src.looping && want >= durationS);
  el.loop = src.looping;
  if (!playing) {
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - want) > 0.04) el.currentTime = want;
    el.playbackRate = 1;
    return;
  }
  if (el.paused) void el.play().catch(() => {});
  let drift = want - el.currentTime;
  // Across the loop point, measure the short way round.
  if (src.looping && durationS > 0) {
    if (drift > durationS / 2) drift -= durationS;
    if (drift < -durationS / 2) drift += durationS;
  }
  if (Math.abs(drift) > 0.5) {
    el.currentTime = want;
    el.playbackRate = 1;
  } else if (Math.abs(drift) > 0.03) {
    el.playbackRate = 1 + Math.max(-0.08, Math.min(0.08, drift * 0.8));
  } else {
    el.playbackRate = 1;
  }
}
