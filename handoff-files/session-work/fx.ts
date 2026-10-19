/** An effect as FFmpeg filters, and (for settings that change over the clip) the commands that change them as it plays. */
interface Filters {
  filters: string[];
  /** `target option value` for the settings at a moment. */
  cmds?: (p: Record<string, number>) => string[];
}

/** The hum and its harmonics (50 or 60 Hz, up to 8 of them). */
export function humFrequencies(p: Record<string, number>): number[] {
  const base = (p.mains ?? 1) >= 0.5 ? 60 : 50;
  const n = Math.max(1, Math.min(8, Math.round(p.harmonics ?? 4)));
  return Array.from({ length: n }, (_, i) => base * (i + 1));
}

/** The noise reduction asked for, as afftdn's numbers. */
export const denoiseNumbers = (p: Record<string, number>): { nr: number; nf: number } => ({
  nr: Math.max(1, Math.min(97, (p.amount ?? 50) * 0.4)),
  nf: Math.max(-80, Math.min(-20, p.floor ?? -50)),
});

export function effectFilters(e: PartEffect, name: string): Filters {
  const p = e.p;
  const n = (k: string, d = 0) => (Number.isFinite(p[k]) ? (p[k] as number) : d);
  switch (e.type) {
    case 'eq':
      return {
        filters: [
          ...(n('lowCut') > 10 ? [`highpass=f=${num(n('lowCut'))}`] : []),
          ...(n('low') ? [`bass=g=${num(n('low'))}:f=100:w=0.9`] : []),
          ...(n('lowMid') ? [`equalizer=f=400:t=q:w=0.9:g=${num(n('lowMid'))}`] : []),
          ...(n('highMid') ? [`equalizer=f=2500:t=q:w=0.9:g=${num(n('highMid'))}`] : []),
          ...(n('high') ? [`treble=g=${num(n('high'))}:f=8000:w=0.9`] : []),
        ],
      };
    case 'compressor':
      return {
        filters: [
          `acompressor=threshold=${num(dbToGain(n('threshold', -20)))}:ratio=${num(Math.max(1, n('ratio', 4)))}:attack=${num(n('attack', 10))}:release=${num(n('release', 150))}:makeup=${num(Math.max(1, dbToGain(n('makeup', 3))))}`,
        ],
      };
    case 'denoise': {
      const d = denoiseNumbers(p);
      return {
        filters: ['highpass=f=80', `afftdn@${name}=nr=${num(d.nr)}:nf=${num(d.nf)}`],
        cmds: (q) => {
          const x = denoiseNumbers(q);
          return [`afftdn@${name} nr ${num(x.nr)}`, `afftdn@${name} nf ${num(x.nf)}`];
        },
      };
    }
    case 'voiceiso': {
      // No speech model is bundled for FFmpeg's arnndn: noise reduction that follows the noise, the voice's band, presence and a compressor.
      const k = voiceIsoAmount(p);
      return {
        filters: [
          'highpass=f=100',
          'lowpass=f=9000',
          `afftdn=nr=${num(10 + 20 * k)}:nf=-40:tn=1`,
          `equalizer=f=3000:t=q:w=1:g=${num(4 * k)}`,
          `acompressor=threshold=${num(dbToGain(-24))}:ratio=${num(1 + 3 * k)}:attack=10:release=150:makeup=${num(dbToGain(4 * k))}`,
        ],
      };
    }
    case 'dehum': {
      const q = Math.max(2, Math.min(60, n('q', 18)));
      const fs = humFrequencies(p);
      const g = (v: Record<string, number>) => num(-Math.max(0, v.depth ?? 24));
      return {
        filters: fs.map((f, i) => `equalizer@${name}h${i}=f=${f}:t=q:w=${num(q)}:g=${g(p)}`),
        cmds: (v) => fs.map((_, i) => `equalizer@${name}h${i} g ${g(v)}`),
      };
    }
    case 'deess':
      return { filters: [`deesser=i=${num(n('amount', 50) / 100)}:f=${num(Math.max(0.05, Math.min(0.95, n('freq', 5500) / 24000)))}`] };
    case 'limiter':
      return { filters: [`alimiter=limit=${num(dbToGain(n('ceiling', -1)))}:level=false`] };
    case 'loudnorm':
      // loudnorm works at a high sample rate inside: back to 48 kHz after.
      return {
        filters: [`loudnorm=I=${num(Math.max(-70, Math.min(-5, n('target', -16))))}:TP=${num(Math.max(-9, Math.min(0, n('peak', -1.5))))}:LRA=11`, 'aresample=48000'],
      };
    case 'voice': {
      const k = n('amount', 50) / 100;
      return {
        filters: [
          'highpass=f=80',
          `bass=g=${num(-4 * k)}:f=100:w=0.9`,
          `equalizer=f=2500:t=q:w=0.9:g=${num(4 * k)}`,
          `acompressor=threshold=${num(dbToGain(-12 - 18 * k))}:ratio=${num(1 + 3 * k)}:makeup=${num(dbToGain(6 * k))}`,
        ],
      };
    }
    default:
      return { filters: [] };
  }
}

/** Voice isolation's amount, 0–1. */
export const voiceIsoAmount = (p: Record<string, number>): number => Math.max(0, Math.min(1, (p.amount ?? 70) / 100));

/** A piece's effects, with commands that follow keyframed settings while it plays. */
export function effectChain(effects: PartEffect[], part: number): string[] {
  const out: string[] = [];
  effects.forEach((e, j) => {
    const f = effectFilters(e, `p${part}e${j}`);
    if (e.over?.length && f.cmds) {
      const cmds = f.cmds;
      out.push(`asendcmd=c='${e.over.map(([t, v]) => `${num(t)} ${cmds(v).join(',')}`).join(';')}'`);
    }
    out.push(...f.filters);
  });
  return out;
}

/** FFmpeg's sidechain compressor for ducking (the speech is its second input). */
export function duckFilter(d: Duck): string {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return `sidechaincompress=threshold=${num(clamp(dbToGain(d.threshold), 0.000976563, 1))}:ratio=${num(clamp(d.ratio, 1, 20))}:attack=${num(clamp(d.attack, 0.01, 2000))}:release=${num(clamp(d.release, 0.01, 9000))}`;
}

