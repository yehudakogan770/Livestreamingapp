// Voice cleanup while editing: close stand-ins, in the browser's sound
// system, for what FFmpeg does on export. Hum removal, the voice band,
// presence, compression and ducking match the export; noise reduction is
// previewed by a noise gate and low cut, and loudness is estimated as it plays.
import { denoiseNumbers, humFrequencies, voiceIsoAmount } from '../export/audioplan';
import type { EffectNow } from '../render/frame';
import { dbToGain, type Duck, type Heard } from './audio';

/** Loudness heard so far in a clip (gated mean square, K-weighted). */
export interface Measure {
  sum: number;
  n: number;
}

/** How far a ducked clip is turned down (1 = not at all) when the speech is at `speechDb` (as a compressor with that threshold and ratio). */
export function duckGain(speechDb: number, d: Duck): number {
  const over = speechDb - d.threshold;
  return over > 0 ? dbToGain(-over * (1 - 1 / Math.max(1, d.ratio))) : 1;
}

/** The gain (dB) that brings a clip to the target loudness, from what was heard so far (none yet: unchanged). */
export function loudnessGain(m: Measure | undefined, target: number): number {
  if (!m || m.n < 8 || m.sum <= 0) return 0;
  const lufs = -0.691 + 10 * Math.log10(m.sum / m.n);
  return Math.max(-20, Math.min(20, target - lufs));
}

/** The noise gate's gain: quiet below the threshold (the noise between words), open above it. */
export function gateGain(levelDb: number, threshold: number, depthDb: number): number {
  return levelDb < threshold ? dbToGain(-depthDb) : 1;
}

const rmsDb = (a: AnalyserNode, buf: Float32Array<ArrayBuffer>): { db: number; ms: number } => {
  a.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  const ms = sum / buf.length;
  return { db: ms > 1e-12 ? 10 * Math.log10(ms) : -120, ms };
};

const filter = (ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = 0.7071): BiquadFilterNode => {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
};

const chain = (nodes: AudioNode[]): void => {
  for (let i = 0; i < nodes.length - 1; i++) (nodes[i] as AudioNode).connect(nodes[i + 1] as AudioNode);
};

/** Change an audio setting smoothly, and only when it really changes. */
const glide = (p: AudioParam, v: number, at: number, k = 0.02): void => {
  if (Math.abs(p.value - v) > 1e-4) p.setTargetAtTime(v, at, k);
};

export class VoiceChain {
  /** Cleanup before the compressor: low cut, voice band, hum, presence, gate, de-ess, voice compressor. */
  readonly input: GainNode;
  readonly output: GainNode;
  /** After the limiter: loudness and ducking. */
  readonly postIn: GainNode;
  readonly postOut: GainNode;
  private hp: BiquadFilterNode;
  private lp: BiquadFilterNode;
  private hum: BiquadFilterNode[];
  private presence: BiquadFilterNode;
  private tap: AnalyserNode;
  private gate: GainNode;
  private dsIn: GainNode;
  private dsOut: GainNode;
  private dsLow: BiquadFilterNode[];
  private dsHigh: BiquadFilterNode[];
  private dsComp: DynamicsCompressorNode;
  private deessOn = false;
  private vcomp: DynamicsCompressorNode;
  private vmakeup: GainNode;
  private loudTap: AnalyserNode;
  private loud: GainNode;
  private duck: GainNode;
  private buf = new Float32Array(2048);
  /** The quiet level between words (dB), followed as it plays. */
  private floor = -60;

  constructor(private ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.hp = filter(ctx, 'highpass', 10);
    this.lp = filter(ctx, 'lowpass', 22000);
    this.hum = Array.from({ length: 8 }, (_, i) => {
      const b = filter(ctx, 'peaking', 60 * (i + 1), 18);
      b.gain.value = 0;
      return b;
    });
    this.presence = filter(ctx, 'peaking', 3000, 1);
    this.presence.gain.value = 0;
    this.tap = ctx.createAnalyser();
    this.tap.fftSize = 2048;
    this.gate = ctx.createGain();
    this.dsIn = ctx.createGain();
    this.dsOut = ctx.createGain();
    // De-ess: a split at the crossover (Linkwitz–Riley, so the two halves add back flat); the top half is compressed.
    this.dsLow = [filter(ctx, 'lowpass', 5500), filter(ctx, 'lowpass', 5500)];
    this.dsHigh = [filter(ctx, 'highpass', 5500), filter(ctx, 'highpass', 5500)];
    this.dsComp = ctx.createDynamicsCompressor();
    this.dsComp.attack.value = 0.002;
    this.dsComp.release.value = 0.08;
    this.vcomp = ctx.createDynamicsCompressor();
    this.vcomp.threshold.value = 0;
    this.vcomp.ratio.value = 1;
    this.vmakeup = ctx.createGain();
    chain([this.input, this.hp, this.lp, ...this.hum, this.presence, this.gate, this.dsIn]);
    this.presence.connect(this.tap);
    chain([this.dsLow[0] as AudioNode, this.dsLow[1] as AudioNode, this.dsOut]);
    chain([this.dsHigh[0] as AudioNode, this.dsHigh[1] as AudioNode, this.dsComp, this.dsOut]);
    this.dsIn.connect(this.dsOut);
    chain([this.dsOut, this.vcomp, this.vmakeup, this.output]);
    this.postIn = ctx.createGain();
    this.postOut = ctx.createGain();
    this.loud = ctx.createGain();
    this.duck = ctx.createGain();
    // Loudness is heard as people hear it (roughly K-weighted).
    const kw = [filter(ctx, 'highpass', 38, 0.5), filter(ctx, 'highshelf', 1500)];
    (kw[1] as BiquadFilterNode).gain.value = 4;
    this.loudTap = ctx.createAnalyser();
    this.loudTap.fftSize = 2048;
    chain([this.postIn, ...kw, this.loudTap]);
    chain([this.postIn, this.loud, this.duck, this.postOut]);
  }

  /** De-ess on (through the split) or off (straight through). */
  private setDeess(on: boolean) {
    if (on === this.deessOn) return;
    this.deessOn = on;
    this.dsIn.disconnect();
    if (on) {
      this.dsIn.connect(this.dsLow[0] as AudioNode);
      this.dsIn.connect(this.dsHigh[0] as AudioNode);
    } else this.dsIn.connect(this.dsOut);
  }

  /**
   * Follow the clip's cleanup effects at this moment. `speechDb` is how loud
   * the speech tracks are now (for ducking); `measure` keeps the clip's
   * loudness so far.
   */
  apply(h: Heard, speechDb: number, measure: Measure): void {
    const at = this.ctx.currentTime;
    const fx = (t: string): EffectNow | undefined => h.effects.find((e) => e.type === t);
    const dn = fx('denoise');
    const vi = fx('voiceiso');
    const hum = fx('dehum');
    const ds = fx('deess');
    const ln = fx('loudnorm');
    const k = vi ? voiceIsoAmount(vi.p) : 0;
    glide(this.hp.frequency, vi ? 100 : dn ? 80 : 10, at);
    glide(this.lp.frequency, vi ? 9000 : 22000, at);
    glide(this.presence.gain, 4 * k, at);
    // Remove hum: the same peaking cuts as the export.
    const fs = hum ? humFrequencies(hum.p) : [];
    this.hum.forEach((b, i) => {
      const f = fs[i];
      if (f !== undefined && hum) {
        b.frequency.value = Math.min(f, this.ctx.sampleRate / 2 - 100);
        b.Q.value = Math.max(2, Math.min(60, hum.p.q ?? 18));
        glide(b.gain, f < this.ctx.sampleRate / 2 - 100 ? -Math.max(0, hum.p.depth ?? 24) : 0, at);
      } else glide(b.gain, 0, at);
    });
    // Noise reduction preview: a gate under the noise level.
    if (dn || vi) {
      const { db } = rmsDb(this.tap, this.buf);
      this.floor = db < this.floor ? db : Math.min(-20, this.floor + 0.03);
      const threshold = dn ? denoiseNumbers(dn.p).nf + 6 : this.floor + 10;
      const depth = Math.max(dn ? (dn.p.amount ?? 50) * 0.3 : 0, vi ? 12 + 18 * k : 0);
      const g = gateGain(db, threshold, depth);
      glide(this.gate.gain, g, at, g < this.gate.gain.value ? 0.08 : 0.01);
    } else glide(this.gate.gain, 1, at);
    this.setDeess(!!ds);
    if (ds) {
      const amount = Math.max(0, Math.min(100, ds.p.amount ?? 50));
      const f = Math.max(2000, Math.min(12000, ds.p.freq ?? 5500));
      for (const b of [...this.dsLow, ...this.dsHigh]) b.frequency.value = f;
      this.dsComp.threshold.value = -10 - amount * 0.4;
      this.dsComp.ratio.value = 2 + amount / 8;
    }
    this.vcomp.threshold.value = vi ? -24 : 0;
    this.vcomp.ratio.value = vi ? 1 + 3 * k : 1;
    glide(this.vmakeup.gain, vi ? dbToGain(4 * k) : 1, at);
    // Loudness: what was heard so far (without the clip's own volume), brought to the target.
    if (ln) {
      const { ms } = rmsDb(this.loudTap, this.buf);
      const g2 = Math.max(1e-6, h.gain * h.gain);
      const block = -0.691 + 10 * Math.log10(Math.max(1e-12, ms / g2));
      if (block > -70) {
        measure.sum += ms / g2;
        measure.n += 1;
      }
      glide(this.loud.gain, dbToGain(loudnessGain(measure, ln.p.target ?? -16)), at, 0.3);
    } else glide(this.loud.gain, 1, at);
    // Ducking: down quickly when the speech comes, back up slowly.
    const dg = h.duck ? duckGain(speechDb, h.duck) : 1;
    const down = dg < this.duck.gain.value;
    glide(this.duck.gain, dg, at, Math.max(0.001, ((down ? h.duck?.attack : h.duck?.release) ?? 50) / 1000 / 3));
  }
}
