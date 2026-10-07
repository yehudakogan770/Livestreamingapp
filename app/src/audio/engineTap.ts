// The sound of a mix, to the unified engine's encoders: an audio worklet
// taps the mix (the Stream mix, or the Recording mix) and hands it over in
// 40 ms pieces of 16-bit stereo, each stamped with the wall-clock time of its
// first sample. The engine puts each piece at its own time in the file next
// to the picture (crates/live-engine/src/encoder.rs), so sound and picture
// line up however late a piece arrives. See docs/ENGINE.md.

const WORKLET = `
class LumoraEngineTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = (options.processorOptions && options.processorOptions.size) || 1920;
    this.l = new Float32Array(this.size);
    this.r = new Float32Array(this.size);
    this.n = 0;
    this.first = 0;
  }
  process(inputs) {
    const input = inputs[0];
    const l = input && input[0];
    const r = (input && input[1]) || l;
    const frames = l ? l.length : 128;
    for (let i = 0; i < frames; i++) {
      if (this.n === 0) this.first = currentFrame + i;
      this.l[this.n] = l ? l[i] : 0;
      this.r[this.n] = r ? r[i] : 0;
      this.n++;
      if (this.n === this.size) {
        this.port.postMessage({ l: this.l, r: this.r, frame: this.first }, [this.l.buffer, this.r.buffer]);
        this.l = new Float32Array(this.size);
        this.r = new Float32Array(this.size);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('lumora-engine-tap', LumoraEngineTap);
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

/** Two channels of -1 … 1 floats as interleaved little-endian 16-bit samples. */
export function toPcm16(l: Float32Array, r: Float32Array): Uint8Array {
  const out = new Int16Array(l.length * 2);
  for (let i = 0; i < l.length; i++) {
    const a = Math.max(-1, Math.min(1, l[i]!));
    const b = Math.max(-1, Math.min(1, r[i]!));
    out[i * 2] = Math.round(a < 0 ? a * 0x8000 : a * 0x7fff);
    out[i * 2 + 1] = Math.round(b < 0 ? b * 0x8000 : b * 0x7fff);
  }
  return new Uint8Array(out.buffer);
}

/**
 * The wall-clock time (ms) of the sample numbered `frame` on the sound
 * clock, given the clock now: `contextTime` (s) at wall-clock `wallNow` (ms).
 */
export function wallTimeOf(frame: number, sampleRate: number, contextTime: number, wallNow: number): number {
  return wallNow - (contextTime - frame / sampleRate) * 1000;
}

/** Sends a piece of sound to the engine. */
export type SendPcm = (pcm: Uint8Array, atMs: number, rate: number) => Promise<void>;

/** One mix, tapped while someone needs it. */
export class EngineTap {
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private stopped = false;
  private release: (() => void) | null = null;

  constructor(
    private readonly ctx: AudioContext,
    /** Connects the mix into the tap; returns how to disconnect it. */
    private readonly connect: (into: AudioNode) => () => void,
    private readonly send: SendPcm,
  ) {
    void this.start();
  }

  private async start() {
    try {
      await loadWorklet(this.ctx);
    } catch {
      return;
    }
    if (this.stopped) return;
    const rate = this.ctx.sampleRate;
    const node = new AudioWorkletNode(this.ctx, 'lumora-engine-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      processorOptions: { size: Math.round(rate * 0.04) },
    });
    node.port.onmessage = (e: MessageEvent<{ l: Float32Array; r: Float32Array; frame: number }>) => {
      const at = wallTimeOf(e.data.frame, rate, this.ctx.currentTime, Date.now());
      void this.send(toPcm16(e.data.l, e.data.r), at, rate).catch(() => {});
    };
    // A worklet runs only while something downstream pulls it: a silent path to the speakers.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(this.ctx.destination);
    this.release = this.connect(node);
    this.node = node;
    this.sink = sink;
    void this.ctx.resume().catch(() => {});
  }

  stop(): void {
    this.stopped = true;
    this.release?.();
    this.release = null;
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
    }
    this.sink?.disconnect();
    this.node = null;
    this.sink = null;
  }
}
