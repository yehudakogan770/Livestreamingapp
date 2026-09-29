// Live sound from a stream input: raw 48 kHz stereo 16-bit from the app's
// frame server, played through a tiny audio worklet that keeps about 80 ms
// in hand — low delay, and it catches up by itself if it falls behind.

const WORKLET = `
class LumoraPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 48000 * 4;
    this.l = new Float32Array(this.size);
    this.r = new Float32Array(this.size);
    this.write = 0;
    this.read = 0;
    this.started = false;
    this.step = 48000 / sampleRate;
    this.port.onmessage = (e) => {
      const { l, r } = e.data;
      for (let i = 0; i < l.length; i++) {
        this.l[this.write % this.size] = l[i];
        this.r[this.write % this.size] = r[i];
        this.write++;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const n = out[0].length;
    let have = this.write - this.read;
    // Wait for ~80 ms before starting; jump ahead if more than 250 ms piles up.
    if (!this.started) {
      if (have < 3840) return true;
      this.started = true;
    }
    if (have > 12000) this.read = this.write - 3840;
    for (let i = 0; i < n; i++) {
      have = this.write - this.read;
      if (have < 2) {
        this.started = false;
        out[0][i] = 0;
        if (out[1]) out[1][i] = 0;
        continue;
      }
      const p = Math.floor(this.read);
      const f = this.read - p;
      const a = p % this.size;
      const b = (p + 1) % this.size;
      out[0][i] = this.l[a] + (this.l[b] - this.l[a]) * f;
      if (out[1]) out[1][i] = this.r[a] + (this.r[b] - this.r[a]) * f;
      this.read += this.step;
    }
    return true;
  }
}
registerProcessor('lumora-pcm', LumoraPcm);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

function loadWorklet(ctx: AudioContext): Promise<void> {
  let p = loaded.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    p = ctx.audioWorklet.addModule(url);
    loaded.set(ctx, p);
  }
  return p;
}

/** Plays a stream input's sound into `into` until stopped. */
export class PcmStream {
  private stopped = false;
  private node: AudioWorkletNode | null = null;
  private abort: AbortController | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly url: () => Promise<string | null>,
    private readonly into: AudioNode,
  ) {
    void this.start();
  }

  private async start() {
    if (!('audioWorklet' in this.ctx)) return;
    try {
      await loadWorklet(this.ctx);
    } catch {
      return;
    }
    if (this.stopped) return;
    this.node = new AudioWorkletNode(this.ctx, 'lumora-pcm', { numberOfInputs: 0, outputChannelCount: [2] });
    this.node.connect(this.into);
    while (!this.stopped) {
      await this.pump().catch(() => {});
      if (!this.stopped) await new Promise((r) => setTimeout(r, 1000));
    }
  }

  /** Read the sound until the connection ends. */
  private async pump() {
    const url = await this.url();
    if (!url || this.stopped) return;
    this.abort = new AbortController();
    const res = await fetch(url, { signal: this.abort.signal });
    const reader = res.body?.getReader();
    if (!reader) return;
    let rest = new Uint8Array(0);
    for (;;) {
      const { done, value } = await reader.read();
      if (done || this.stopped) return;
      // Whole stereo samples only; a piece may end mid-sample.
      const bytes = rest.length ? concat(rest, value) : value;
      const whole = bytes.length - (bytes.length % 4);
      rest = bytes.slice(whole);
      const frames = whole / 4;
      const view = new DataView(bytes.buffer, bytes.byteOffset, whole);
      const l = new Float32Array(frames);
      const r = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        l[i] = view.getInt16(i * 4, true) / 32768;
        r[i] = view.getInt16(i * 4 + 2, true) / 32768;
      }
      this.node?.port.postMessage({ l, r }, [l.buffer, r.buffer]);
    }
  }

  stop(): void {
    this.stopped = true;
    this.abort?.abort();
    this.node?.disconnect();
    this.node = null;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const c = new Uint8Array(a.length + b.length);
  c.set(a);
  c.set(b, a.length);
  return c;
}
