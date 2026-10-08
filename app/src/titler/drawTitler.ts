// Drawing a Titler graphic in Lumora's canvas drawing (recordings, the
// stream, and the unified engine's overlay renderer) and in the screen
// windows: IN when its overlay comes on, HOLD while on, OUT when taken off.

import { browserEnv, type BrowserEnv } from '../../../titler/src/core/browserEnv';
import { renderFrame } from '../../../titler/src/core/render';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import type { TitlerGraphic } from '../engine/types/TitlerGraphic';
import { brandTokens, cueAt, projectOf, valuesOf } from './titlerSource';

export interface ChannelState {
  on: boolean;
  changedAt: number;
}

export class TitlerPainter {
  readonly env: BrowserEnv;
  /** When each graphic last came on (its ticker keeps moving through the OUT). */
  private inAt = new Map<string, number>();

  constructor(urlFor: (path: string) => string) {
    this.env = browserEnv(urlFor);
  }

  /**
   * Draw `src` at `now` into a w × h box. `channel`: the overlay channel it is
   * in (on/off and when that changed); none when it is a screen's picture,
   * which plays its IN from `since` and holds.
   */
  paint(ctx: CanvasRenderingContext2D, src: Source, k: TitlerGraphic, show: Show | null, now: number, w: number, h: number, channel: ChannelState | null, since: number): boolean {
    const p = projectOf(k);
    if (!p) return false;
    let r;
    if (channel) {
      if (channel.on) this.inAt.set(src.id, channel.changedAt);
      r = cueAt(p, channel.on, channel.changedAt, this.inAt.get(src.id) ?? channel.changedAt - 60_000, now);
    } else r = cueAt(p, true, since, since, now);
    if (r.phase === 'done') return false;
    const { values } = valuesOf(p, k, show, now);
    renderFrame(ctx, p, { time: r.t, clock: r.clock, values, brand: brandTokens(show?.event.brand), env: this.env, width: w, height: h });
    return r.phase !== 'hold';
  }
}
