// Which inputs have a picture right now, as this window sees them: every view
// of a camera tells this when a new frame arrives, a view that can't show its
// input (camera unplugged, file broken) says so, and stream inputs are told
// from the stream's status. The backup lineup (./backup.ts) reads it. The
// clock is passed in, so it can be tested.

/** Why an input has no picture, in plain words. */
export type DownReason = string;

interface Entry {
  /** Hard failures, by who reported them (unplugged, refused, file broken, stream lost). */
  failed: Map<symbol, DownReason>;
  /** Views counting this input's frames now. */
  watchers: number;
  /** When frames started being counted (so a camera that is opening gets time). */
  watchedSince: number;
  lastFrame: number | null;
  /** A pretend loss (the test event, "Try it"), until this time. */
  simulatedUntil: number;
}

/** A camera that has not shown its first frame gets at least this long. */
export const FIRST_FRAME_MS = 5000;
/** Frames only count as stopped while this window itself is drawing (not hidden or busy). */
export const BEAT_MS = 700;

/** Who reports a stream's status (one per window). */
const STATUS = Symbol('status');

type Listener = () => void;

export class InputHealth {
  private entries = new Map<string, Entry>();
  private listeners = new Set<Listener>();
  private lastBeat: number;

  constructor(private readonly clock: () => number = () => performance.now()) {
    this.lastBeat = clock();
  }

  now(): number {
    return this.clock();
  }

  private entry(id: string): Entry {
    let e = this.entries.get(id);
    if (!e) {
      e = { failed: new Map(), watchers: 0, watchedSince: this.clock(), lastFrame: null, simulatedUntil: 0 };
      this.entries.set(id, e);
    }
    return e;
  }

  /** This window is drawing (call it every animation frame). Stalls are only judged while it is. */
  beat(): void {
    this.lastBeat = this.clock();
  }

  /** A view starts counting this input's frames; call the returned function when it stops. */
  watch(id: string): () => void {
    const e = this.entry(id);
    if (e.watchers === 0) {
      e.watchedSince = this.clock();
      e.lastFrame = null;
    }
    e.watchers++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      e.watchers = Math.max(0, e.watchers - 1);
    };
  }

  /** A new frame of this input arrived. */
  frame(id: string): void {
    this.entry(id).lastFrame = this.clock();
  }

  /** `who` says the input failed (or `null`: not any more, as far as `who` knows). */
  report(id: string, who: symbol, why: DownReason | null): void {
    const e = this.entry(id);
    if ((e.failed.get(who) ?? null) === why) return;
    if (why === null) e.failed.delete(who);
    else e.failed.set(who, why);
    if (why === null && e.watchers) e.lastFrame = this.clock();
    this.changed();
  }

  /** The input's own status (a stream's): failed, or `null` when it works. */
  setFailed(id: string, why: DownReason | null): void {
    this.report(id, STATUS, why);
  }

  /** Pretend the input lost its picture for `ms` (the test event, rehearsals). */
  simulate(id: string, ms: number): void {
    this.entry(id).simulatedUntil = this.clock() + ms;
    this.changed();
  }

  /** Stop pretending (one input, or all). */
  endSimulation(id?: string): void {
    for (const [k, e] of this.entries) if (id === undefined || k === id) e.simulatedUntil = 0;
    this.changed();
  }

  /** Is a pretend loss running for this input? */
  simulated(id: string): boolean {
    return (this.entries.get(id)?.simulatedUntil ?? 0) > this.clock();
  }

  /** Why this input has no picture now (null: it has one, or nobody can tell). */
  down(id: string, lostAfterMs: number): DownReason | null {
    const e = this.entries.get(id);
    if (!e) return null;
    const now = this.clock();
    if (e.simulatedUntil > now) return 'No signal (test)';
    const failed = e.failed.values().next();
    if (!failed.done) return failed.value;
    if (e.watchers === 0) return null;
    // A hidden or busy window gets no frames at all: that says nothing about the camera.
    if (now - this.lastBeat > BEAT_MS) return null;
    const since = e.lastFrame ?? e.watchedSince;
    const wait = e.lastFrame === null ? Math.max(lostAfterMs, FIRST_FRAME_MS) : lostAfterMs;
    return now - since > wait ? 'No picture coming in' : null;
  }

  /** Everything down among `ids`, with why. */
  downAll(ids: Iterable<string>, lostAfterMs: number): Map<string, DownReason> {
    const out = new Map<string, DownReason>();
    for (const id of ids) {
      const why = this.down(id, lostAfterMs);
      if (why) out.set(id, why);
    }
    return out;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private changed() {
    for (const l of this.listeners) l();
  }
}

/** This window's input health. */
export const inputHealth = new InputHealth();

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

/**
 * Count a video element's frames for an input (a camera). Does nothing where
 * the browser can't say when frames arrive. Returns the function that stops.
 */
export function watchFrames(id: string, video: HTMLVideoElement, health: InputHealth = inputHealth): () => void {
  const v = video as FrameVideo;
  if (typeof v.requestVideoFrameCallback !== 'function') return () => {};
  const stop = health.watch(id);
  let handle = 0;
  let alive = true;
  const next = () => {
    if (!alive) return;
    health.frame(id);
    handle = v.requestVideoFrameCallback!(next);
  };
  handle = v.requestVideoFrameCallback(next);
  return () => {
    alive = false;
    v.cancelVideoFrameCallback?.(handle);
    stop();
  };
}
