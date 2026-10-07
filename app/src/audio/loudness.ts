// Loudness in LUFS (ITU-R BS.1770 / EBU R128), measured on the Stream mix:
// the sound is K-weighted (a high shelf and a high pass, close to how loud
// people hear it), its power summed over the channels every 100 ms, and from
// those blocks come the momentary (0.4 s), short-term (3 s) and integrated
// (the whole event, gated) loudness. The filtering runs in an AudioWorklet
// (off the main thread, sample by sample); the rest is here.

/** One biquad filter: y = b0·x + b1·x₁ + b2·x₂ − a1·y₁ − a2·y₂. */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The two K-weighting filters for a sample rate (as libebur128 works them out). */
export function kWeighting(fs: number): [Biquad, Biquad] {
  // Stage 1: the head's high shelf (+4 dB above about 1.7 kHz).
  let f0 = 1681.974450955533;
  const g = 3.999843853973347;
  let q = 0.7071752369554196;
  let k = Math.tan((Math.PI * f0) / fs);
  const vh = 10 ** (g / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const shelf: Biquad = {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  // Stage 2: the high pass (the RLB curve, below about 38 Hz).
  f0 = 38.13547087602444;
  q = 0.5003270373238773;
  k = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + k / q + k * k;
  const highPass: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0 };
  return [shelf, highPass];
}

/** Power (mean square) → LUFS. */
export function lufs(power: number): number {
  return power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;
}

/**
 * K-weight one channel’s samples and return the sum of their squares;
 * `state` (4 numbers per stage) carries on between calls.
 */
export function kWeightedSquares(samples: ArrayLike<number>, filters: [Biquad, Biquad], state: Float64Array): number {
  const [s, h] = filters;
  let [x1, x2, y1, y2, z1, z2, w1, w2] = state as unknown as number[];
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!;
    const y = s.b0 * x + s.b1 * x1! + s.b2 * x2! - s.a1 * y1! - s.a2 * y2!;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    const w = h.b0 * y + h.b1 * z1! + h.b2 * z2! - h.a1 * w1! - h.a2 * w2!;
    z2 = z1;
    z1 = y;
    w2 = w1;
    w1 = w;
    sum += w * w;
  }
  state.set([x1!, x2!, y1!, y2!, z1!, z2!, w1!, w2!]);
  return sum;
}

/** Gating: blocks quieter than this are silence (never counted). */
const ABSOLUTE_GATE = -70;
/** The histogram covers −70 to +5 LUFS in 0.1 LU steps (memory stays small for any length). */
const BIN = 0.1;
const BINS = 750;

/** Loudness from 100 ms blocks of K-weighted power (summed over the channels). */
export class LoudnessMeter {
  private readonly recent: number[] = [];
  private readonly counts = new Float64Array(BINS);
  private readonly energy = new Float64Array(BINS);
  private blocks = 0;

  /** Add one 100 ms block's power. */
  add(power: number): void {
    this.recent.push(Math.max(0, power));
    if (this.recent.length > 30) this.recent.shift();
    // A gating block is 400 ms, starting every 100 ms (75 % overlap).
    if (this.recent.length >= 4) {
      const p = this.mean(4);
      const l = lufs(p);
      if (l > ABSOLUTE_GATE) {
        const i = Math.min(BINS - 1, Math.floor((l - ABSOLUTE_GATE) / BIN));
        this.counts[i]! += 1;
        this.energy[i]! += p;
        this.blocks++;
      }
    }
  }

  private mean(n: number): number {
    const last = this.recent.slice(-n);
    return last.reduce((a, b) => a + b, 0) / last.length;
  }

  /** The last 0.4 seconds (−∞ until there is that much). */
  get momentary(): number {
    return this.recent.length >= 4 ? lufs(this.mean(4)) : -Infinity;
  }

  /** The last 3 seconds: the one to watch while mixing. */
  get shortTerm(): number {
    return this.recent.length >= 30 ? lufs(this.mean(30)) : this.recent.length >= 4 ? lufs(this.mean(this.recent.length)) : -Infinity;
  }

  /** Since the start (or the last reset), with silence and quiet parts left out. */
  get integrated(): number {
    if (!this.blocks) return -Infinity;
    let total = 0;
    for (let i = 0; i < BINS; i++) total += this.energy[i]!;
    // Relative gate: 10 LU below the loudness of everything above the absolute gate.
    const gate = lufs(total / this.blocks) - 10;
    let n = 0;
    let e = 0;
    for (let i = 0; i < BINS; i++) {
      if (ABSOLUTE_GATE + (i + 1) * BIN <= gate) continue;
      n += this.counts[i]!;
      e += this.energy[i]!;
    }
    return n ? lufs(e / n) : -Infinity;
  }

  /** Seconds measured (blocks above the absolute gate). */
  get seconds(): number {
    return this.blocks / 10;
  }

  reset(): void {
    this.recent.length = 0;
    this.counts.fill(0);
    this.energy.fill(0);
    this.blocks = 0;
  }
}

/** Common loudness targets. */
export const TARGETS = [
  { lufs: -14, name: '−14 LUFS: YouTube, Spotify, most streaming' },
  { lufs: -16, name: '−16 LUFS: podcasts, Apple' },
  { lufs: -23, name: '−23 LUFS: TV (EBU R128)' },
] as const;

/** How close a reading is to the target, in words and as ok, low or high. */
export function targetHint(reading: number, target: number): { state: 'none' | 'ok' | 'low' | 'high'; text: string } {
  if (!Number.isFinite(reading) || reading < -60) return { state: 'none', text: 'No sound yet' };
  const off = reading - target;
  if (Math.abs(off) <= 1) return { state: 'ok', text: 'On target' };
  const lu = Math.abs(off).toFixed(0);
  return off < 0 ? { state: 'low', text: `${lu} dB too quiet` } : { state: 'high', text: `${lu} dB too loud` };
}

/** A reading for the screen: "−15.2". */
export function lufsText(v: number): string {
  if (!Number.isFinite(v) || v < -60) return '−∞';
  return v.toFixed(1).replace('-', '−');
}

/** The AudioWorklet that K-weights the sound and sends the power every 100 ms. */
export const WORKLET = `
class LumoraLoudness extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.f = options.processorOptions.filters;
    this.state = [new Float64Array(8), new Float64Array(8)];
    this.block = Math.round(sampleRate / 10);
    this.sum = 0;
    this.n = 0;
  }
  squares(x, st) {
    const s = this.f[0], h = this.f[1];
    let x1 = st[0], x2 = st[1], y1 = st[2], y2 = st[3], z1 = st[4], z2 = st[5], w1 = st[6], w2 = st[7];
    let sum = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const y = s.b0 * v + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
      const w = h.b0 * y + h.b1 * z1 + h.b2 * z2 - h.a1 * w1 - h.a2 * w2;
      z2 = z1; z1 = y; w2 = w1; w1 = w;
      sum += w * w;
    }
    st[0] = x1; st[1] = x2; st[2] = y1; st[3] = y2; st[4] = z1; st[5] = z2; st[6] = w1; st[7] = w2;
    return sum;
  }
  process(inputs) {
    const input = inputs[0];
    const frames = input && input[0] ? input[0].length : 128;
    if (input && input.length) {
      // Mono counts as both ears.
      if (input.length === 1) this.sum += 2 * this.squares(input[0], this.state[0]);
      else for (let c = 0; c < 2; c++) this.sum += this.squares(input[c], this.state[c]);
    }
    this.n += frames;
    if (this.n >= this.block) {
      this.port.postMessage(this.sum / this.n);
      this.sum = 0;
      this.n = 0;
    }
    return true;
  }
}
registerProcessor('lumora-loudness', LumoraLoudness);
`;

/**
 * Measure a node's loudness. Returns the meter and a function that stops it,
 * or null where AudioWorklet is missing (the meter then stays empty).
 */
export async function measureLoudness(ctx: AudioContext, node: AudioNode, meter: LoudnessMeter): Promise<(() => void) | null> {
  if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return null;
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const worklet = new AudioWorkletNode(ctx, 'lumora-loudness', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: 'explicit',
    processorOptions: { filters: kWeighting(ctx.sampleRate) },
  });
  worklet.port.onmessage = (e: MessageEvent<number>) => meter.add(e.data);
  // Pulled by the speakers' clock, silently.
  const silent = ctx.createGain();
  silent.gain.value = 0;
  node.connect(worklet);
  worklet.connect(silent);
  silent.connect(ctx.destination);
  return () => {
    worklet.port.onmessage = null;
    node.disconnect(worklet);
    worklet.disconnect();
    silent.disconnect();
  };
}
