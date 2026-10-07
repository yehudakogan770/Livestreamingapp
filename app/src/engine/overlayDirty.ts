// What changed between two frames of a graphics plane (dirty rectangles), and
// when the overlay renderer draws at all (frame pacing). Pure: see
// overlayRenderer.ts for where they are used, docs/ENGINE.md for why.

import type { Rect } from './overlayWire';

/** Tiles compared at a time (pixels a side). */
export const TILE = 32;
/** More rectangles than this become their bounding box (each costs a GPU copy). */
export const MAX_RECTS = 24;

/**
 * The rectangles of `next` that differ from `prev` (both `w` × `h` RGBA as
 * 32-bit words). A missing `prev` counts as fully transparent: a new plane
 * sends only what is drawn on it. Tiles that changed are joined into runs
 * along a row, and runs with the same columns on consecutive rows into one
 * rectangle.
 */
export function dirtyRects(prev: Uint32Array | null, next: Uint32Array, w: number, h: number, tile = TILE): Rect[] {
  const cols = Math.ceil(w / tile);
  const rows = Math.ceil(h / tile);
  const runs: Rect[] = [];
  const open = new Map<string, Rect>();
  for (let ty = 0; ty < rows; ty++) {
    const y0 = ty * tile;
    const y1 = Math.min(h, y0 + tile);
    const dirty: boolean[] = new Array<boolean>(cols).fill(false);
    for (let tx = 0; tx < cols; tx++) {
      const x0 = tx * tile;
      const x1 = Math.min(w, x0 + tile);
      outer: for (let y = y0; y < y1; y++) {
        const row = y * w;
        for (let x = x0; x < x1; x++) {
          const i = row + x;
          if (next[i] !== (prev ? prev[i] : 0)) {
            dirty[tx] = true;
            break outer;
          }
        }
      }
    }
    // Runs of dirty tiles on this row of tiles.
    const here = new Map<string, Rect>();
    for (let tx = 0; tx < cols; ) {
      if (!dirty[tx]) {
        tx++;
        continue;
      }
      let end = tx;
      while (end + 1 < cols && dirty[end + 1]) end++;
      const x = tx * tile;
      const rw = Math.min(w, (end + 1) * tile) - x;
      const key = `${x}:${rw}`;
      const above = open.get(key);
      if (above && above.y + above.h === y0) {
        above.h = y1 - above.y;
        here.set(key, above);
      } else {
        const r = { x, y: y0, w: rw, h: y1 - y0 };
        runs.push(r);
        here.set(key, r);
      }
      tx = end + 1;
    }
    open.clear();
    for (const [k, r] of here) open.set(k, r);
  }
  if (runs.length > MAX_RECTS) return [bounds(runs)];
  return runs;
}

/** The smallest rectangle around all of them. */
export function bounds(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Pixels in the rectangles. */
export const area = (rects: Rect[]) => rects.reduce((a, r) => a + r.w * r.h, 0);

/**
 * When the overlay renderer draws. While something is happening (the show
 * just changed, or the last frames changed: an animation, a running clock
 * at its tick) it draws at the screen's rate; when nothing has changed for
 * a while it only looks a few times a second, so a still title costs next to
 * nothing and sends nothing. A frame still on its way to the engine holds
 * the next one back (the newest is drawn when it is free, never a queue).
 */
export class Pacer {
  private activeUntil = -Infinity;
  private last = -Infinity;
  private busy = false;

  constructor(
    /** The screen's frame rate (while something moves). */
    readonly fps: number,
    /** How often it looks when nothing moves. */
    readonly idleFps = 15,
    /** How long it stays at the full rate after the last change (ms). */
    readonly settleMs = 600,
  ) {}

  /** Something changed: full rate for a while. */
  wake(now: number): void {
    this.activeUntil = Math.max(this.activeUntil, now + this.settleMs);
  }

  /** At the full rate now. */
  active(now: number): boolean {
    return now < this.activeUntil;
  }

  /** Whether to draw a frame at `now` (and if so, it counts as drawn). */
  due(now: number): boolean {
    if (this.busy) return false;
    const period = 1000 / (this.active(now) ? this.fps : this.idleFps);
    // A little early is fine: timers fire late more often than early.
    if (now - this.last < period - 2) return false;
    this.last = now;
    return true;
  }

  /** A frame is on its way to the engine (true) or arrived (false). */
  sending(on: boolean): void {
    this.busy = on;
  }
}
