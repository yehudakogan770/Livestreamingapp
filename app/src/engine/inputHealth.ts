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

/** Frames the camera itself has sent (Chromium's track stats), whether or not they are drawn. */
function framesSent(video: HTMLVideoElement): number | null {
  const src = video.srcObject as MediaStream | null;
  const track = src && typeof src.getVideoTracks === 'function' ? src.getVideoTracks()[0] : undefined;
  const total = (track as (MediaStreamTrack & { stats?: { totalFrames?: unknown } }) | undefined)?.stats?.totalFrames;
  return typeof total === 'number' ? total : null;
}

/** A picture that is drawn some other way (green screen, picture delay): its own frames can't be seen. */
const drawnElsewhere = (video: HTMLVideoElement) => !!video.closest('.keyed') || video.style.opacity === '0';

/**
 * Count a camera's frames for an input. Uses the frames the camera sends
 * where the browser can say (so it works however the picture is drawn), else
 * the frames shown in this video element. Does nothing where neither can be
 * told. Returns the function that stops.
 */
export function watchFrames(id: string, video: HTMLVideoElement, health: InputHealth = inputHealth, pollMs = 250): () => void {
  const v = video as FrameVideo;
  const canShow = typeof v.requestVideoFrameCallback === 'function';
  const canCount = typeof MediaStream !== 'undefined' && typeof MediaStreamTrack !== 'undefined' && 'stats' in MediaStreamTrack.prototype;
  if (!canShow && !canCount) return () => {};
  const stop = health.watch(id);
  let alive = true;
  let handle = 0;
  let last: number | null = null;
  // Shown frames are counted only while the camera's own count can't be read:
  // once it can, the poll below does it, and nothing runs on every frame.
  let showing = false;
  const show = () => {
    showing = true;
    handle = v.requestVideoFrameCallback!(next);
  };
  const next = () => {
    if (!alive) return;
    if (framesSent(v) !== null) {
      showing = false;
      return;
    }
    health.frame(id);
    handle = v.requestVideoFrameCallback!(next);
  };
  if (canShow) show();
  const poll = setInterval(() => {
    const sent = framesSent(v);
    if (sent !== null) {
      if (sent !== last) health.frame(id);
      last = sent;
    } else if (canShow && !showing) {
      // The count went away (another stream): back to counting shown frames.
      last = null;
      show();
    } else if (!canShow || drawnElsewhere(v)) {
      // Nothing to judge by: never call it lost for that.
      health.frame(id);
    }
  }, pollMs);
  return () => {
    alive = false;
    clearInterval(poll);
    if (canShow) v.cancelVideoFrameCallback?.(handle);
    stop();
  };
}
