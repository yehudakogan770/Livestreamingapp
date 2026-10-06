// Helpers for the tests: a clock that only moves when told to, and a show.

import type { Timers } from './protocol';

export class FakeTimers implements Timers {
  time = 1_000_000;
  private nextId = 1;
  private readonly pending = new Map<number, { at: number; fn: () => void }>();

  set(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.pending.set(id, { at: this.time + ms, fn });
    return id;
  }

  clear(id: unknown): void {
    this.pending.delete(id as number);
  }

  now(): number {
    return this.time;
  }

  get count(): number {
    return this.pending.size;
  }

  /** Move the clock on, running whatever comes due (in order). */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.pending) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.pending.delete(next[0]);
      this.time = next[1].at;
      next[1].fn();
    }
    this.time = end;
  }
}

/** A small show, as Lumora sends it. */
export function sampleShow(): Record<string, unknown> {
  return {
    sources: [
      { id: 'cam1', name: 'Camera 1', kind: { type: 'camera' } },
      { id: 'cam2', name: 'Camera 2', kind: { type: 'camera' } },
      { id: 'slides', name: 'Slides', kind: { type: 'slideshow' } },
      { id: 'cd', name: 'Doors open', kind: { type: 'countdown', timer: { endsAt: null, remainingMs: 90_000, lengthMs: 300_000 } } },
    ],
    screens: {
      live: { program: 'cam1', preview: 'cam2', blank: false },
      back: { program: 'slides', preview: null, blank: true },
    },
    overlays: [
      { sourceId: 'slides', on: true, inNext: false },
      { sourceId: null, on: false, inNext: true },
      { sourceId: null, on: false, inNext: false },
      { sourceId: null, on: false, inNext: false },
    ],
    presets: [
      { id: 'p1', name: 'Welcome' },
      { id: 'p2', name: 'Speeches' },
    ],
    activePreset: 'p2',
    panic: false,
    run: { cues: [{ name: 'Walk-in' }, { name: 'Opening' }], current: 0, running: true },
  };
}
