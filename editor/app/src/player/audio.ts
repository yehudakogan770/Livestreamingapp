// What is heard at a frame: each sound clip, how loud, where in its file.
import { valueAt } from '../model/anim';
import { end, onTrack, rate } from '../model/seq';
import type { Clip, MediaItem, Project, Sequence, Track } from '../model/types';
import { effectsAt, isAudioEffect, sourceAt, type EffectNow } from '../render/frame';

export interface Heard {
  clip: Clip;
  track: Track;
  media: MediaItem;
  /** Seconds into the file. */
  time: number;
  /** 0… (1 = as recorded), with fades and the clip's volume line. */
  gain: number;
  pan: number;
  effects: EffectNow[];
}

export const dbToGain = (db: number): number => (db <= -60 ? 0 : 10 ** (db / 20));

/** Which audio tracks are heard (solo wins over everything else). */
export function heardTracks(s: Sequence): Set<string> {
  const audio = s.tracks.filter((t) => t.kind === 'audio');
  const solo = audio.some((t) => t.solo);
  return new Set(audio.filter((t) => (solo ? t.solo : !t.off)).map((t) => t.id));
}

/** How loud a crossfade side is (constant power sounds even; constant gain is a straight line). */
export function fadeCurve(type: string, x: number): number {
  const k = Math.max(0, Math.min(1, x));
  return type === 'crossfadelinear' ? k : Math.sin((k * Math.PI) / 2);
}

/** Every sound clip playing at a frame, including the overlap of crossfades. */
export function audioAt(p: Project, s: Sequence, frame: number): Heard[] {
  const fps = rate(s);
  const out: Heard[] = [];
  for (const t of s.tracks) {
    if (t.kind !== 'audio') continue;
    const clips = onTrack(s, t.id).filter((c) => c.enabled && c.source.kind === 'media');
    for (const c of clips) {
      const half = c.tIn ? Math.floor(c.tIn.length / 2) : 0;
      const next = clips.find((o) => o.start === end(c) && o.id !== c.id);
      const nextHalf = next?.tIn ? next.tIn.length - Math.floor(next.tIn.length / 2) : 0;
      const prev = clips.find((o) => end(o) === c.start && o.id !== c.id);
      const from = c.start - (c.tIn && prev ? half : 0);
      const to = end(c) + nextHalf;
      if (frame < from || frame >= to) continue;
      let fade = 1;
      if (c.tIn) {
        const w0 = c.start - half;
        const len = c.tIn.length;
        if (frame < w0 + len) fade *= fadeCurve(c.tIn.type, (frame - w0 + 0.5) / len);
      }
      if (next?.tIn) {
        const len = next.tIn.length;
        const w0 = next.start - Math.floor(len / 2);
        if (frame >= w0) fade *= fadeCurve(next.tIn.type, 1 - (frame - w0 + 0.5) / len);
      }
      if (c.tOut && !next) {
        const w0 = end(c) - c.tOut.length;
        if (frame >= w0) fade *= fadeCurve(c.tOut.type, 1 - (frame - w0 + 0.5) / c.tOut.length);
      }
      const src = c.source;
      if (src.kind !== 'media') continue;
      const m = p.media.find((x) => x.id === src.media);
      if (!m?.hasAudio) continue;
      const local = frame - c.start;
      const time = sourceAt(c, local, fps);
      if (time < 0 || time >= m.duration) continue;
      const lc = Math.max(0, Math.min(c.length - 1, local));
      out.push({
        clip: c,
        track: t,
        media: m,
        time,
        gain: dbToGain(valueAt(c.gain, lc)) * fade,
        pan: Math.max(-1, Math.min(1, valueAt(c.pan, lc) / 100)),
        effects: effectsAt(c, local, 'audio', isAudioEffect),
      });
    }
  }
  return out;
}
