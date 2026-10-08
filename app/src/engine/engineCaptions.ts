// Live captions written into the stream picture, with the unified engine:
// the control window (where the speech model runs) passes the lines to the
// Live Screen's overlay renderer, which draws them into the plane `cap`;
// the engine puts that plane only on the stream and its vertical version
// (never on the screen or the recording), as the Standard recorder's
// CaptionLayer does. See docs/ENGINE.md.

import type { Captions } from './types/Captions';

export interface CaptionsInPicture {
  lines: string[];
  look: Captions;
}

/** The event the Live Screen's overlay renderer listens to. */
export const CAPTIONS_EVENT = 'engine-captions';

/**
 * Every `ms`, send the captions to write now when they changed (and again
 * every `again` ticks, so a renderer that started since gets them too).
 * Returns a stop function.
 */
export function relayCaptions(get: () => CaptionsInPicture | null, send: (c: CaptionsInPicture | null) => void, ms = 200, again = 10): () => void {
  let last: string | null = null;
  let ticks = 0;
  const tick = () => {
    const c = get();
    const now = c && c.lines.length ? c : null;
    const key = JSON.stringify(now);
    ticks++;
    if (key === last && ticks % again !== 0) return;
    last = key;
    send(now);
  };
  tick();
  const id = setInterval(tick, ms);
  return () => clearInterval(id);
}
