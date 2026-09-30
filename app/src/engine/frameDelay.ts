// Holding a camera's picture back a little, so it lines up with sound that
// arrives late (a sound desk, wireless microphones). Each new frame of the
// video is kept as a picture; the one from `delay` ago is shown.

/** The longest delay, ms. */
export const MAX_VIDEO_DELAY_MS = 1000;

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export class FrameDelay {
  private frames: { t: number; bmp: ImageBitmap }[] = [];
  private stopped = false;
  private busy = false;
  private handle = 0;
  private timer = 0;

  constructor(
    private readonly video: HTMLVideoElement,
    private delayMs: number,
  ) {
    this.watch();
  }

  setDelay(ms: number): void {
    this.delayMs = Math.min(MAX_VIDEO_DELAY_MS, Math.max(0, ms));
  }

  /** Keep each new frame (every frame the camera sends, where the browser can tell; else ~30 a second). */
  private watch() {
    const v = this.video as FrameVideo;
    const next = () => {
      if (this.stopped) return;
      this.keep();
      if (v.requestVideoFrameCallback) this.handle = v.requestVideoFrameCallback(next);
      else this.timer = window.setTimeout(next, 33);
    };
    next();
  }

  private keep() {
    const v = this.video;
    if (this.busy || v.readyState < 2 || !v.videoWidth) return;
    this.busy = true;
    const t = performance.now();
    createImageBitmap(v)
      .then((bmp) => {
        if (this.stopped) return bmp.close();
        this.frames.push({ t, bmp });
        // Never keep more than the delay needs (and a little).
        const oldest = performance.now() - this.delayMs - 500;
        while (this.frames.length > 2 && this.frames[1]!.t < oldest) this.frames.shift()!.bmp.close();
      })
      .catch(() => undefined)
      .finally(() => (this.busy = false));
  }

  /** The frame to show now: the newest one at least `delay` old (the oldest kept while it builds up). */
  frame(): ImageBitmap | null {
    const due = performance.now() - this.delayMs;
    let pick: ImageBitmap | null = this.frames[0]?.bmp ?? null;
    for (const f of this.frames) {
      if (f.t > due) break;
      pick = f.bmp;
    }
    return pick;
  }

  dispose(): void {
    this.stopped = true;
    const v = this.video as FrameVideo;
    if (this.handle && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.handle);
    clearTimeout(this.timer);
    for (const f of this.frames) f.bmp.close();
    this.frames = [];
  }
}
