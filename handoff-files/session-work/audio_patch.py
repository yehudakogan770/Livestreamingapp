p = 'export/audioplan.ts'
s = open(p).read()


def rep(a, b):
    global s
    assert a in s, a
    s = s.replace(a, b, 1)


rep("""import { isAudioEffect, sourceAt } from '../render/frame';
""", """import { isAudioEffect, sourceAt } from '../render/frame';
import { soundPieces } from '../model/remap';
""")
rep("""  /** Turned down under the speech tracks (FFmpeg's sidechain compressor). */
  duck: Duck | null;
}""", """  /** Turned down under the speech tracks (FFmpeg's sidechain compressor). */
  duck: Duck | null;
  /** false: the pitch follows the speed (like tape); otherwise it is kept. */
  pitch?: boolean;
}""")
rep("""      let w1 = end(c) + (next?.tIn ? next.tIn.length - Math.floor(next.tIn.length / 2) : 0);
""", """      let w1 = end(c) + (next?.tIn ? next.tIn.length - Math.floor(next.tIn.length / 2) : 0);
      // Time remapping: the sound in pieces of one speed each (freezes are silent).
      if (c.remap) {
        const lo = Math.max(w0, from);
        const hi = Math.min(w1, to);
        for (const x of remapParts(p, s, c, t, m.missing && m.proxy ? m.proxy : m.path, m.duration, lo, hi, fps)) parts.push({ ...x, clip: c });
        continue;
      }
""")
rep("""/** A clip's sound effects for the piece [w0, w1)""", """/** A remapped clip's sound over [w0, w1): a part for each stretch of one speed and direction. */
function remapParts(p: Project, s: Sequence, c: Clip, t: Track, path: string, duration: number, w0: number, w1: number, fps: number): Part[] {
  const out: Part[] = [];
  if (w1 <= w0) return out;
  for (const piece of soundPieces(c, w0, w1, fps)) {
    if (Math.abs(piece.rate) < 1e-3) continue;
    const a = sourceAt(c, piece.from - c.start, fps);
    const b = sourceAt(c, piece.to - c.start, fps);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi <= 0 || lo >= duration) continue;
    const marks = new Set<number>([piece.from, piece.to - 1]);
    for (let f = piece.from; f < piece.to; f += Math.max(1, Math.round(fps / 4))) marks.add(f);
    const lc = Math.max(0, Math.min(c.length - 1, piece.from - c.start));
    out.push({
      path,
      track: t,
      from: piece.from,
      to: piece.to,
      srcFrom: Math.max(0, lo),
      speed: ((hi - lo) * fps) / (piece.to - piece.from),
      reverse: b < a,
      envelope: thin([...marks].sort((x, y) => x - y).map((f) => [(f - piece.from) / fps, gainOf(p, s, c, f)] as [number, number])),
      pan: Math.max(-1, Math.min(1, valueAt(c.pan, lc) / 100)),
      effects: partEffects(c, piece.from, piece.to, fps),
      duck: duckOf(c, t, lc),
      pitch: c.remap?.pitch !== false,
    });
  }
  return out;
}

/** A clip's sound effects for the piece [w0, w1)""")
rep("""      ...tempo(x.speed),
""", """      ...(x.pitch === false ? varispeed(x.speed) : tempo(x.speed)),
""")
rep("""function tempo(speed: number): string[] {""", """/** Faster or slower with the pitch following (like tape): the sound's rate changed, then made 48 kHz again. */
export function varispeed(speed: number): string[] {
  if (Math.abs(speed - 1) < 1e-4) return [];
  return [`asetrate=${num(48000 * Math.max(0.05, speed))}`, 'aresample=48000'];
}

/** Faster or slower keeping the pitch (FFmpeg's atempo, chained for big changes). */
export function tempo(speed: number): string[] {""")
open(p, 'w').write(s)
