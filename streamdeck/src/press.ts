// Turning key presses into exactly one request each.
//
// - A key held down sends once, however long it is held (Stream Deck and
//   some keyboards repeat the key-down while held).
// - A bounce (a second key-down within a few milliseconds) is ignored.
// - Hold keys (PANIC, going live…) only fire once held long enough, and
//   letting go early cancels.
// - A second press soon after the first is a double press (Input keys: the
//   first press lines the input up in Next, the second cuts it to air).

import type { Timers } from './protocol';
import { realTimers } from './protocol';

export const BOUNCE_MS = 60;
/** How often a held key's progress is redrawn. */
export const HOLD_TICK_MS = 100;

export interface GestureHandlers {
  /** A press (or the first press of a double). */
  press(): void;
  /** A second press soon after the first. */
  double?(): void;
  /** Held long enough. */
  held?(): void;
  /** Hold progress, 0 – 1 (null: the hold ended). */
  progress?(p: number | null): void;
  /** Let go too early. */
  cancelled?(): void;
}

export interface GestureOptions {
  /** Hold this long first (0: no hold). Decided at each key-down. */
  holdMs: () => number;
  /** Presses this close together make a double press (0: no double press). */
  doubleMs?: number;
  timers?: Timers;
}

export class Gesture {
  private down = false;
  private lastDown = -Infinity;
  private lastPress = -Infinity;
  private holdTimer: unknown = null;
  private tickTimer: unknown = null;
  private holding = 0;
  private readonly timers: Timers;

  constructor(
    private readonly on: GestureHandlers,
    private readonly options: GestureOptions,
  ) {
    this.timers = options.timers ?? realTimers;
  }

  get isDown(): boolean {
    return this.down;
  }

  keyDown(): void {
    const now = this.timers.now();
    // Repeats while held, and bounces, are one press.
    if (this.down || now - this.lastDown < BOUNCE_MS) return;
    this.down = true;
    this.lastDown = now;
    const hold = this.options.holdMs();
    if (hold > 0) return this.startHold(hold);
    const double = this.options.doubleMs ?? 0;
    if (double > 0 && this.on.double && now - this.lastPress <= double) {
      // A third press starts over (press, double, press…).
      this.lastPress = -Infinity;
      this.on.double();
      return;
    }
    this.lastPress = now;
    this.on.press();
  }

  keyUp(): void {
    if (!this.down) return;
    this.down = false;
    if (this.holdTimer !== null) {
      this.stopHold();
      this.on.cancelled?.();
    }
  }

  /** The key went away (page changed, profile switched): forget any hold. */
  reset(): void {
    this.down = false;
    if (this.holdTimer !== null) this.stopHold();
  }

  private startHold(ms: number): void {
    this.holding = this.timers.now();
    this.on.progress?.(0);
    this.holdTimer = this.timers.set(() => {
      this.stopHold();
      (this.on.held ?? this.on.press)();
    }, ms);
    const tick = () => {
      this.tickTimer = this.timers.set(() => {
        if (this.holdTimer === null) return;
        this.on.progress?.(Math.min(1, (this.timers.now() - this.holding) / ms));
        tick();
      }, HOLD_TICK_MS);
    };
    tick();
  }

  private stopHold(): void {
    this.timers.clear(this.holdTimer);
    this.timers.clear(this.tickTimer);
    this.holdTimer = this.tickTimer = null;
    this.on.progress?.(null);
  }
}
