p='export/audioplan.ts'
s=open(p).read()
s=s.replace("""import { valueAt } from '../model/anim';
import { end, rate } from '../model/seq';
import type { Clip, Project, Sequence, Track } from '../model/types';
import { dbToGain, heardTracks, audioAt } from '../player/audio';
import { sourceAt } from '../render/frame';
""","""import { isAnim, valueAt } from '../model/anim';
import { end, rate } from '../model/seq';
import type { Clip, Project, Sequence, Track } from '../model/types';
import { dbToGain, duckOf, heardTracks, audioAt, type Duck } from '../player/audio';
import { isAudioEffect, sourceAt } from '../render/frame';

/** A sound effect on a piece: its settings at the start, and (when keyframed) how they change, by seconds from the piece's start. */
export interface PartEffect {
  type: string;
  p: Record<string, number>;
  over?: [number, Record<string, number>][];
}
""")
s=s.replace("""  pan: number;
  effects: { type: string; p: Record<string, number> }[];
}""","""  pan: number;
  effects: PartEffect[];
  /** Turned down under the speech tracks (FFmpeg's sidechain compressor). */
  duck: Duck | null;
}""")
s=s.replace("""        pan: Math.max(-1, Math.min(1, valueAt(c.pan, lc) / 100)),
        effects: c.effects
          .filter((e) => e.on && ['eq', 'compressor', 'denoise', 'deess', 'limiter', 'voice'].includes(e.type))
          .map((e) => ({ type: e.type, p: Object.fromEntries(Object.entries(e.p).map(([k, v]) => [k, valueAt(v, lc)])) })),
      });""","""        pan: Math.max(-1, Math.min(1, valueAt(c.pan, lc) / 100)),
        effects: partEffects(c, w0, w1, fps),
        duck: duckOf(c, t, lc),
      });""")
s=s.replace("""/**
 * The sound of a nested sequence,""","""/** A clip's sound effects for the piece [w0, w1): keyframed settings are followed every tenth of a second. */
function partEffects(c: Clip, w0: number, w1: number, fps: number): PartEffect[] {
  const at = (e: Clip['effects'][number], f: number) => {
    const lc = Math.max(0, Math.min(c.length - 1, f - c.start));
    return Object.fromEntries(Object.entries(e.p).map(([k, v]) => [k, valueAt(v, lc)]));
  };
  return c.effects
    .filter((e) => e.on && isAudioEffect(e.type) && e.type !== 'duck')
    .map((e) => {
      const fx: PartEffect = { type: e.type, p: at(e, w0) };
      if (!Object.values(e.p).some(isAnim)) return fx;
      const step = Math.max(1, Math.round(fps / 10));
      const over: [number, Record<string, number>][] = [];
      let last = JSON.stringify(fx.p);
      for (let f = w0 + step; f < w1; f += step) {
        const v = at(e, f);
        const key = JSON.stringify(v);
        if (key === last) continue;
        last = key;
        over.push([(f - w0) / fps, v]);
      }
      return over.length ? { ...fx, over } : fx;
    });
}

/**
 * The sound of a nested sequence,""")
s=s.replace("""      last.pan === x.pan &&
      JSON.stringify(last.effects) === JSON.stringify(x.effects)""","""      last.pan === x.pan &&
      JSON.stringify(last.effects) === JSON.stringify(x.effects) &&
      JSON.stringify(last.duck) === JSON.stringify(x.duck)""")
a=s.index("function effectFilters(")
b=s.index("export interface SoundGraph")
s=s[:a]+open('/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/fx.ts').read()+s[b:]
open(p,'w').write(s)
