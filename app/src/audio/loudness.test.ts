import { describe, expect, it } from 'vitest';
import { kWeighting, kWeightedSquares, LoudnessMeter, lufs, lufsText, targetHint, WORKLET } from './loudness';

const FS = 48000;

/** A sine's 100 ms blocks of K-weighted power, on one channel or both. */
function sineBlocks(freq: number, amplitude: number, seconds: number, fs = FS, channels = 2): number[] {
  const f = kWeighting(fs);
  const state = new Float64Array(8);
  const per = fs / 10;
  const out: number[] = [];
  let t = 0;
  for (let b = 0; b < seconds * 10; b++) {
    const x = new Float32Array(per);
    for (let i = 0; i < per; i++, t++) x[i] = amplitude * Math.sin((2 * Math.PI * freq * t) / fs);
    out.push((channels * kWeightedSquares(x, f, state)) / per);
  }
  return out;
}

describe('loudness (BS.1770)', () => {
  it('has the standard’s K-weighting at 48 kHz', () => {
    const [s, h] = kWeighting(48000);
    expect(s.b0).toBeCloseTo(1.53512485958697, 10);
    expect(s.b1).toBeCloseTo(-2.69169618940638, 10);
    expect(s.b2).toBeCloseTo(1.19839281085285, 10);
    expect(s.a1).toBeCloseTo(-1.69065929318241, 10);
    expect(s.a2).toBeCloseTo(0.73248077421585, 10);
    expect(h.a1).toBeCloseTo(-1.99004745483398, 10);
    expect(h.a2).toBeCloseTo(0.99007225036621, 10);
  });

  it('reads a full-scale 1 kHz tone on one channel as −3.01 LUFS, as the standard says', () => {
    const m = new LoudnessMeter();
    for (const p of sineBlocks(1000, 1, 4, FS, 1)) m.add(p);
    expect(m.momentary).toBeCloseTo(-3.01, 1);
    expect(m.shortTerm).toBeCloseTo(-3.01, 1);
    expect(m.integrated).toBeCloseTo(-3.01, 1);
    // On both channels it is 3 dB louder.
    const both = new LoudnessMeter();
    for (const p of sineBlocks(1000, 1, 4)) both.add(p);
    expect(both.shortTerm).toBeCloseTo(0, 1);
  });

  it('measures the same at 44.1 kHz', () => {
    const m = new LoudnessMeter();
    for (const p of sineBlocks(1000, 0.1, 3, 44100)) m.add(p);
    expect(m.shortTerm).toBeCloseTo(-20.0, 1);
  });

  it('leaves silence and quiet parts out of the whole-event reading', () => {
    const m = new LoudnessMeter();
    const loud = sineBlocks(1000, 0.1, 10); // −20 LUFS
    const quiet = sineBlocks(1000, 0.01, 10); // −40 LUFS: below the relative gate
    for (const p of [...loud, ...new Array<number>(100).fill(0), ...quiet]) m.add(p);
    // Blocks half in the silence count a little, as the standard says.
    expect(m.integrated).toBeCloseTo(-20.0, 0);
    expect(m.momentary).toBeCloseTo(-40, 0);
    m.reset();
    expect(m.integrated).toBe(-Infinity);
    expect(m.seconds).toBe(0);
  });

  it('the worklet measures what the main thread does', () => {
    const posted: number[] = [];
    let Processor: new (o: unknown) => { process(i: Float32Array[][]): boolean; port: { postMessage(v: number): void } } = null!;
    class Base {
      port = { postMessage: (v: number) => posted.push(v) };
    }
    // Run the worklet's code with what an AudioWorkletGlobalScope gives it.
    new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', WORKLET)(Base, (_: string, c: typeof Processor) => (Processor = c), FS);
    const p = new Processor({ processorOptions: { filters: kWeighting(FS) } });
    let t = 0;
    for (let q = 0; q < 375 * 4; q++) {
      const x = new Float32Array(128);
      for (let i = 0; i < 128; i++, t++) x[i] = Math.sin((2 * Math.PI * 1000 * t) / FS);
      p.process([[x, x]]);
    }
    expect(posted.length).toBeGreaterThanOrEqual(39);
    expect(lufs(posted[posted.length - 1]!)).toBeCloseTo(0, 1);
  });

  it('says how far from the target', () => {
    expect(targetHint(-14.4, -14)).toEqual({ state: 'ok', text: 'On target' });
    expect(targetHint(-20, -14)).toEqual({ state: 'low', text: '6 dB too quiet' });
    expect(targetHint(-10, -16)).toEqual({ state: 'high', text: '6 dB too loud' });
    expect(targetHint(-Infinity, -23).state).toBe('none');
    expect(lufsText(-15.24)).toBe('−15.2');
    expect(lufsText(-Infinity)).toBe('−∞');
  });
});
