// A mixing stage while editing (a sound track, a bus or the whole mix): its
// processing (low cut, four-band equalizer, compressor with make-up gain,
// limiter), its fader and pan, and a meter. The same settings make the film
// through FFmpeg (export/audioplan.ts).
import { activeFx, fxNumber } from '../model/mix';
import type { Effect } from '../model/types';
import { dbToGain } from './audio';

export interface Stage {
  input: GainNode;
  lowCut: BiquadFilterNode;
  eq: BiquadFilterNode[];
  comp: DynamicsCompressorNode;
  makeup: GainNode;
  limit: DynamicsCompressorNode;
  /** The fader. */
  gain: GainNode;
  pan: StereoPannerNode;
  meter: AnalyserNode;
  /** Where it goes now (a stage's id, or 'out'). */
  dest: string;
}

export const EQ_BANDS: [BiquadFilterType, number, string][] = [
  ['lowshelf', 100, 'low'],
  ['peaking', 400, 'lowMid'],
  ['peaking', 2500, 'highMid'],
  ['highshelf', 8000, 'high'],
];

export function makeStage(ctx: BaseAudioContext): Stage {
  const input = ctx.createGain();
  const lowCut = ctx.createBiquadFilter();
  lowCut.type = 'highpass';
  lowCut.frequency.value = 10;
  const eq = EQ_BANDS.map(([type, f]) => {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = 0.9;
    b.gain.value = 0;
    return b;
  });
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = 0;
  comp.ratio.value = 1;
  const makeup = ctx.createGain();
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = 0;
  limit.ratio.value = 1;
  limit.attack.value = 0.001;
  limit.knee.value = 0;
  const gain = ctx.createGain();
  const pan = ctx.createStereoPanner();
  const meter = ctx.createAnalyser();
  meter.fftSize = 1024;
  let node: AudioNode = input;
  for (const n of [lowCut, ...eq, comp, makeup, limit, gain, pan]) {
    node.connect(n);
    node = n;
  }
  pan.connect(meter);
  return { input, lowCut, eq, comp, makeup, limit, gain, pan, meter, dest: '' };
}

/** Set a stage's processing from its effects (switched-off or missing ones pass the sound through). */
export function applyStageFx(st: Stage, fx: Effect[] | undefined): void {
  const on = activeFx(fx);
  const eq = on.find((e) => e.type === 'eq');
  st.lowCut.frequency.value = Math.max(10, fxNumber(eq, 'lowCut', 0));
  st.eq.forEach((b, i) => (b.gain.value = eq ? fxNumber(eq, (EQ_BANDS[i] as [BiquadFilterType, number, string])[2], 0) : 0));
  const comp = on.find((e) => e.type === 'compressor');
  st.comp.threshold.value = comp ? fxNumber(comp, 'threshold', -20) : 0;
  st.comp.ratio.value = comp ? Math.max(1, fxNumber(comp, 'ratio', 4)) : 1;
  st.comp.attack.value = comp ? fxNumber(comp, 'attack', 10) / 1000 : 0.003;
  st.comp.release.value = comp ? fxNumber(comp, 'release', 150) / 1000 : 0.25;
  st.makeup.gain.value = comp ? dbToGain(fxNumber(comp, 'makeup', 3)) : 1;
  const limit = on.find((e) => e.type === 'limiter');
  st.limit.threshold.value = limit ? fxNumber(limit, 'ceiling', -1) : 0;
  st.limit.ratio.value = limit ? 20 : 1;
}

/** Point a stage's output somewhere else (its meter stays on). */
export function routeStage(st: Stage, dest: string, to: AudioNode): void {
  if (st.dest === dest) return;
  st.pan.disconnect();
  st.pan.connect(st.meter);
  st.pan.connect(to);
  st.dest = dest;
}
