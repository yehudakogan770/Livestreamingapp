// A benchmark of the render cache's bookkeeping on a big project: a two-hour
// 4K timeline with eight video tracks, thousands of clips with effects, color
// nodes and keyframes. It times planning every segment's key from scratch,
// again after a one-parameter edit (unchanged clips reuse their hashes), and
// checks that the edit changes only the segments the clip reaches.
//
// Numbers printed with: LUMORA_BENCH=1 npx vitest run editor/app/src/cache/cache.bench.test.ts
import { describe, expect, it } from 'vitest';
import { newEffect } from '../model/effects';
import { addSerial, newGrade, newGradeEffect } from '../model/grade';
import { emptyProject, newClip, newTrack, type Clip, type MediaItem, type Project, type Sequence } from '../model/types';
import { segmentKeys } from './key';
import { planSegments } from './plan';

const LOUD = !!process.env.LUMORA_BENCH;

function bigProject(minutes: number, tracks: number): Project {
  const p = emptyProject('big');
  const base = p.sequences[0] as Sequence;
  const vt = Array.from({ length: tracks }, (_, i) => newTrack('video', i + 1));
  const media: MediaItem[] = Array.from({ length: 40 }, (_, i) => ({
    id: `m${i}`,
    name: `cam ${i}`,
    path: `/footage/cam${i}.mov`,
    proxy: null,
    kind: 'video',
    duration: 3600,
    width: i % 3 === 0 ? 6144 : 3840,
    height: i % 3 === 0 ? 3456 : 2160,
    fps: 25,
    hasVideo: true,
    hasAudio: true,
    bin: null,
  }));
  const fps = 25;
  const len = minutes * 60 * fps;
  const clips: Clip[] = [];
  vt.forEach((t, ti) => {
    // Shorter clips on the lower tracks (the edit), longer ones above (graphics, layers).
    const each = ti < 2 ? 4 * fps : 20 * fps;
    for (let start = ti * 7; start + each <= len; start += each + (ti < 2 ? 0 : 10 * fps)) {
      const n = clips.length;
      const c = newClip(t.id, start, each, { kind: 'media', media: `m${n % media.length}`, in: (n % 50) * 2 }, `c${n}`);
      c.id = `c${n}`;
      c.effects = [newGradeEffect(addSerial(addSerial(newGrade(), null), null)), newEffect('vignette')];
      if (n % 5 === 0) c.effects.push(newEffect('blur'));
      if (n % 9 === 0)
        c.motion = {
          ...c.motion,
          scale: {
            k: [
              { t: 0, v: 100, e: 'ease' },
              { t: each - 1, v: 120, e: 'ease' },
            ],
          },
        };
      if (ti < 2 && n % 4 === 0) c.tIn = { type: 'dissolve', length: 12 };
      clips.push(c);
    }
  });
  const seq: Sequence = { ...base, width: 3840, height: 2160, fps, tracks: vt, clips };
  return { ...p, media, sequences: [seq], open: seq.id };
}

const time = (f: () => void): number => {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
};

describe('render cache keys on a big project', () => {
  it('plans a two-hour, eight-track 4K timeline quickly and invalidates precisely', () => {
    const p = bigProject(120, 8);
    const s = p.sequences[0] as Sequence;
    const format = { height: 1080, high: false };
    let first: ReturnType<typeof planSegments> = [];
    const cold = time(() => (first = planSegments(p, s, { mode: 'smart', format })));
    const warm = time(() => planSegments(p, s, { mode: 'smart', format }));
    // One parameter of one clip in the middle changes.
    const target = s.clips[Math.floor(s.clips.length / 2)] as Clip;
    const edited: Project = {
      ...p,
      sequences: [
        {
          ...s,
          clips: s.clips.map((c) =>
            c === target ? { ...c, effects: c.effects.map((e) => (e.type === 'vignette' ? { ...e, p: { ...e.p, amount: 77 } } : e)) } : c,
          ),
        },
      ],
    };
    let after: ReturnType<typeof planSegments> = [];
    const edit = time(() => (after = planSegments(edited, edited.sequences[0] as Sequence, { mode: 'smart', format })));
    const changed = first.filter((x, i) => x.key !== after[i]?.key);
    const reachEnd = target.start + target.length + (target.tIn ? target.tIn.length : 0);
    const reachStart = target.start - (target.tIn ? target.tIn.length : 0);
    // Only segments the clip reaches, and all of them.
    expect(changed.length).toBeGreaterThan(0);
    for (const x of changed) expect(x.to > reachStart && x.from < reachEnd).toBe(true);
    expect(changed.length).toBeLessThanOrEqual(Math.ceil((reachEnd - reachStart) / 50) + 1);
    const heavy = first.filter((x) => x.needs).length;
    if (LOUD)
      console.log(
        `${s.clips.length} clips, ${first.length} segments (${heavy} heavy): plan from scratch ${cold.toFixed(1)} ms, ` +
          `again ${warm.toFixed(1)} ms, after an edit ${edit.toFixed(1)} ms; ${changed.length} segment(s) invalidated`,
      );
    expect(first.length).toBe(Math.ceil((120 * 60 * 25) / 50));
    // Generous bounds (slow CI machines); typical numbers are a few ms to tens of ms.
    expect(cold).toBeLessThan(3000);
    expect(edit).toBeLessThan(1500);
    // 4K and 6K layered, graded footage: the smart cache wants most of it.
    expect(heavy).toBeGreaterThan(first.length / 2);
    // Keys alone are deterministic across runs.
    expect(segmentKeys(p, s, format).map((k) => k.key)).toEqual(first.map((x) => x.key));
  });
});
