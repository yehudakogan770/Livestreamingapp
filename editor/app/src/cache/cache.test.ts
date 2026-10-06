import { describe, expect, it } from 'vitest';
import { newEffect } from '../model/effects';
import { addSerial, newGrade, newGradeEffect } from '../model/grade';
import {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_TEXT,
  emptyProject,
  newClip,
  newSequence,
  newTrack,
  type Clip,
  type MediaItem,
  type Project,
  type Sequence,
} from '../model/types';
import { hash64, hashOf, stable } from './hash';
import { reach, segmentKeys, type CacheFormat } from './key';
import { cachedOps } from './ops';
import { coverage, planSegments, renderOrder, segmentAt, segmentCost } from './plan';
import { formatFor } from './settings';

const FMT: CacheFormat = { height: 1080, high: false };
const SEG = 60;

function media(id: string, w = 1920, h = 1080, extra: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    name: id,
    path: `/m/${id}.mp4`,
    proxy: null,
    kind: 'video',
    duration: 600,
    width: w,
    height: h,
    fps: 30,
    hasVideo: true,
    hasAudio: true,
    bin: null,
    ...extra,
  };
}

/** Two clips on V1 (0–300, 300–600) and a title on V2 (100–200); a 6K clip on V1 600–900. */
function project(): Project {
  const p = emptyProject('t');
  const s = p.sequences[0] as Sequence;
  const [v1, v2] = s.tracks;
  const a = { ...newClip(v1!.id, 0, 300, { kind: 'media', media: 'a', in: 0 }, 'a'), id: 'A' };
  const b = { ...newClip(v1!.id, 300, 300, { kind: 'media', media: 'b', in: 0 }, 'b'), id: 'B' };
  const t = { ...newClip(v2!.id, 100, 100, { kind: 'text', text: DEFAULT_TEXT }, 'title'), id: 'T' };
  const big = { ...newClip(v1!.id, 600, 300, { kind: 'media', media: 'six', in: 0 }, 'six'), id: 'S' };
  const seq: Sequence = { ...s, fps: 30, clips: [a, b, t, big] };
  return { ...p, media: [media('a'), media('b'), media('six', 6144, 3456)], sequences: [seq], open: seq.id };
}

const seqOf = (p: Project) => p.sequences[0] as Sequence;
const editClip = (p: Project, id: string, f: (c: Clip) => Clip): Project => ({
  ...p,
  sequences: p.sequences.map((s) => ({ ...s, clips: s.clips.map((c) => (c.id === id ? f(c) : c)) })),
});
const keysOf = (p: Project) => segmentKeys(p, seqOf(p), FMT, SEG);

describe('content hashes', () => {
  it('are the same for the same content, whatever the key order', () => {
    expect(stable({ b: 1, a: [1, 'x', { d: null, c: true }] })).toBe(stable({ a: [1, 'x', { c: true, d: null }], b: 1 }));
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
    expect(stable({ a: undefined, b: NaN })).toBe('{"b":null}');
    const h = hash64('hello');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hash64('hello')).toBe(h);
    expect(hash64('hellp')).not.toBe(h);
  });
});

describe('render cache keys', () => {
  it('are deterministic', () => {
    const p = project();
    const a = keysOf(p);
    // A copy with the same content (fresh objects, nothing remembered) gets the same keys.
    const b = keysOf(JSON.parse(JSON.stringify(p)) as Project);
    expect(a.map((k) => k.key)).toEqual(b.map((k) => k.key));
    expect(a.map((k) => [k.from, k.to])).toEqual(Array.from({ length: 15 }, (_, i) => [i * 60, i * 60 + 60]));
    // Every key is a valid cache file name.
    for (const k of a) expect(k.key).toMatch(/^[0-9a-f]{16}$/);
    expect(new Set(a.map((k) => k.key)).size).toBe(a.length);
  });

  it('change only where an effect parameter changed', () => {
    const p = editClip(project(), 'B', (c) => ({ ...c, effects: [newEffect('blur')] }));
    const before = keysOf(p);
    const after = keysOf(editClip(p, 'B', (c) => ({ ...c, effects: c.effects.map((e) => ({ ...e, p: { ...e.p, radius: 40 } })) })));
    const changed = before.filter((k, i) => k.key !== after[i]?.key).map((k) => k.from);
    // B covers 300–600: segments 300, 360, 420, 480, 540.
    expect(changed).toEqual([300, 360, 420, 480, 540]);
  });

  it('change with keyframes, grade nodes and motion, but not with names, labels or sound', () => {
    const p = project();
    const base = keysOf(p).map((k) => k.key);
    const diff = (q: Project) =>
      keysOf(q)
        .filter((k, i) => k.key !== base[i])
        .map((k) => k.from);
    expect(diff(editClip(p, 'A', (c) => ({ ...c, name: 'renamed', label: '#fff', gain: -6, pan: 0.5 })))).toEqual([]);
    expect(diff(editClip(p, 'A', (c) => ({ ...c, effects: [...c.effects, newEffect('eq')] })))).toEqual([]);
    expect(
      diff(
        editClip(p, 'A', (c) => ({
          ...c,
          motion: {
            ...c.motion,
            x: {
              k: [
                { t: 0, v: 0, e: 'linear' },
                { t: 30, v: 50, e: 'linear' },
              ],
            },
          },
        })),
      ),
    ).toEqual([0, 60, 120, 180, 240]);
    const graded = editClip(p, 'T', (c) => ({ ...c, effects: [newGradeEffect(addSerial(newGrade(), null))] }));
    expect(diff(graded)).toEqual([60, 120, 180]);
  });

  it('change where the media file changes', () => {
    const p = project();
    const base = keysOf(p).map((k) => k.key);
    const q = { ...p, media: p.media.map((m) => (m.id === 'six' ? { ...m, path: '/m/other.mov' } : m)) };
    expect(
      keysOf(q)
        .filter((k, i) => k.key !== base[i])
        .map((k) => k.from),
    ).toEqual([600, 660, 720, 780, 840]);
    // A playback proxy being made changes nothing (the cache is drawn from the originals).
    const r = { ...p, media: p.media.map((m) => (m.id === 'six' ? { ...m, playbackProxy: '/c/six.proxy.mp4' } : m)) };
    expect(keysOf(r).map((k) => k.key)).toEqual(base);
  });

  it('reach into transitions and the clip before them', () => {
    const p = editClip(project(), 'B', (c) => ({ ...c, tIn: { type: 'dissolve', length: 20 } }));
    const s = seqOf(p);
    const r = reach(s);
    const a = s.clips.find((c) => c.id === 'A') as Clip;
    const b = s.clips.find((c) => c.id === 'B') as Clip;
    expect(r.get(b)).toEqual([290, 600]);
    expect(r.get(a)).toEqual([0, 310]);
    // Changing the transition changes the segments it covers (and the clips' others), not the 6K clip's.
    const before = keysOf(p);
    const after = keysOf(editClip(p, 'B', (c) => ({ ...c, tIn: { type: 'dissolve', length: 24 } })));
    const changed = before.filter((k, i) => k.key !== after[i]?.key).map((k) => k.from);
    expect(changed).toContain(240);
    expect(changed).toContain(300);
    expect(changed).not.toContain(600);
  });

  it('change everywhere for the sequence size or the cache format', () => {
    const p = project();
    const base = keysOf(p).map((k) => k.key);
    const q = { ...p, sequences: p.sequences.map((s) => ({ ...s, width: 3840, height: 2160 })) };
    expect(keysOf(q).every((k, i) => k.key !== base[i])).toBe(true);
    expect(segmentKeys(p, seqOf(p), { height: 540, high: false }, SEG).every((k, i) => k.key !== base[i])).toBe(true);
  });

  it('leave hidden tracks out', () => {
    const p = project();
    const s = seqOf(p);
    const v2 = s.tracks[1]!.id;
    const hidden = { ...p, sequences: [{ ...s, tracks: s.tracks.map((t) => (t.id === v2 ? { ...t, off: true } : t)) }] };
    const base = keysOf(p);
    const changed = keysOf(hidden)
      .filter((k, i) => k.key !== base[i]?.key)
      .map((k) => k.from);
    expect(changed).toEqual([60, 120, 180]);
  });

  it('follow a nested sequence into its clips', () => {
    const p = project();
    const inner = newSequence('inner');
    const innerClip = newClip(inner.tracks[0]!.id, 0, 100, { kind: 'color', color: '#ff0000' }, 'red');
    const nest = { ...inner, clips: [innerClip] };
    const s = seqOf(p);
    const v3 = s.tracks[2]!.id;
    const outer = { ...s, clips: [...s.clips, { ...newClip(v3, 0, 60, { kind: 'sequence', seq: nest.id, in: 0 }, 'nest'), id: 'N' }] };
    const q: Project = { ...p, sequences: [outer, nest] };
    const base = segmentKeys(q, outer, FMT, SEG).map((k) => k.key);
    const red = { ...q, sequences: [outer, { ...nest, clips: [{ ...innerClip, source: { kind: 'color' as const, color: '#00ff00' } }] }] };
    const after = segmentKeys(red, outer, FMT, SEG).map((k) => k.key);
    expect(after.filter((k, i) => k !== base[i]).length).toBe(1);
    expect(after[0]).not.toBe(base[0]);
  });

  it('change with the look of a captions track inside a nested sequence', () => {
    const p = project();
    const inner = newSequence('inner');
    const capTrack = { ...inner.tracks[0]!, captions: { ...DEFAULT_CAPTION_STYLE } };
    const cap = newClip(capTrack.id, 0, 60, { kind: 'caption', text: 'Hello' }, 'cap');
    const nest = { ...inner, tracks: [capTrack, ...inner.tracks.slice(1)], clips: [cap] };
    const s = seqOf(p);
    const outer = { ...s, clips: [...s.clips, { ...newClip(s.tracks[2]!.id, 0, 60, { kind: 'sequence', seq: nest.id, in: 0 }, 'nest'), id: 'N' }] };
    const q: Project = { ...p, sequences: [outer, nest] };
    const yellow = {
      ...nest,
      tracks: nest.tracks.map((t) => (t.id === capTrack.id ? { ...capTrack, captions: { ...DEFAULT_CAPTION_STYLE, color: '#ffff00' } } : t)),
    };
    const base = segmentKeys(q, outer, FMT, SEG).map((k) => k.key);
    const after = segmentKeys({ ...q, sequences: [outer, yellow] }, outer, FMT, SEG).map((k) => k.key);
    expect(after[0]).not.toBe(base[0]);
  });

  it('change when the clip a title follows is steadied', () => {
    const p = project();
    const path = {
      id: 'P',
      name: 'Track 1',
      points: [
        [0, 0.5, 0.5],
        [299, 0.6, 0.4],
      ] as [number, number, number][],
    };
    const tracked = editClip(p, 'A', (c) => ({ ...c, paths: [path] }));
    // The title sits after the tracked clip (it holds the track's last place), so its segments (300–420) don't hold A itself.
    const following = editClip(tracked, 'T', (c) => ({ ...c, start: 320, follow: { clip: 'A', path: 'P', at: 320, scale: false, rotate: false } }));
    const before = keysOf(following);
    const steadied = editClip(following, 'A', (c) => ({
      ...c,
      stabilize: { path: 'P', smooth: 50, lock: false, at: 0, crop: false, rotate: false, scale: false },
    }));
    const after = keysOf(steadied);
    expect(after[5]?.key).not.toBe(before[5]?.key);
    expect(after[6]?.key).not.toBe(before[6]?.key);
    // A different size of picture moves where the track is in the frame too.
    const bigger = { ...following, media: following.media.map((m) => (m.id === 'a' ? { ...m, width: 3840, height: 1600 } : m)) };
    expect(keysOf(bigger)[6]?.key).not.toBe(before[6]?.key);
  });
});

describe('segment planning', () => {
  it('smart: caches what is too heavy to play live', () => {
    const p = project();
    const segs = planSegments(p, seqOf(p), { mode: 'smart', format: FMT, segment: SEG });
    // Plain 1080p clips and a title play live; the 6K clip decoded at full size doesn't.
    expect(segs.filter((x) => x.needs).map((x) => x.from)).toEqual([600, 660, 720, 780, 840]);
    // With its proxy made, it plays live.
    const proxied = { ...p, media: p.media.map((m) => (m.id === 'six' ? { ...m, playbackProxy: '/c/six.mp4' } : m)) };
    expect(planSegments(proxied, seqOf(proxied), { mode: 'smart', format: FMT, segment: SEG, proxies: true }).some((x) => x.needs)).toBe(false);
  });

  it('smart: AI masks, optical flow and many layers are cached', () => {
    const p = project();
    const masked = editClip(p, 'A', (c) => ({ ...c, effects: [newEffect('personmask')] }));
    expect(
      planSegments(masked, seqOf(masked), { mode: 'smart', format: FMT, segment: SEG })
        .filter((x) => x.needs)
        .map((x) => x.from),
    ).toEqual([0, 60, 120, 180, 240, 600, 660, 720, 780, 840]);
    const flow = editClip(p, 'B', (c) => ({ ...c, remap: { speed: 50, sampling: 'flow', pitch: true } }));
    expect(planSegments(flow, seqOf(flow), { mode: 'smart', format: FMT, segment: SEG }).find((x) => x.from === 300)?.needs).toBe(true);
    // Many graded layers stacked up.
    const s = seqOf(p);
    const tracks = [...s.tracks, ...[4, 5, 6, 7].map((i) => newTrack('video', i))];
    const extra = tracks
      .filter((t) => t.kind === 'video')
      .map((t, i) => ({ ...newClip(t.id, 0, 60, { kind: 'media', media: 'a', in: 0 }, `l${i}`), effects: [newGradeEffect(addSerial(newGrade(), null))] }));
    const stack = { ...p, sequences: [{ ...s, tracks, clips: [...s.clips, ...extra] }] };
    const seg0 = planSegments(stack, seqOf(stack), { mode: 'smart', format: FMT, segment: SEG })[0];
    expect(seg0?.needs).toBe(true);
    expect(seg0?.cost).toBeGreaterThan(1);
    expect(segmentCost(stack, [extra[0] as Clip])).toBeLessThan(0.5);
  });

  it('user: the marked ranges, whatever they hold; off: nothing', () => {
    const p = project();
    const user = planSegments(p, seqOf(p), { mode: 'user', format: FMT, segment: SEG, ranges: [[100, 130]] });
    expect(user.filter((x) => x.needs).map((x) => x.from)).toEqual([60, 120]);
    expect(planSegments(p, seqOf(p), { mode: 'off', format: FMT, segment: SEG }).some((x) => x.needs)).toBe(false);
  });

  it('finds the segment at a frame, orders the work from the playhead, and draws the ruler line', () => {
    const p = project();
    const segs = planSegments(p, seqOf(p), { mode: 'user', format: FMT, segment: SEG, ranges: [[0, 900]] });
    expect(segmentAt(segs, 0)?.from).toBe(0);
    expect(segmentAt(segs, 659)?.from).toBe(600);
    expect(segmentAt(segs, 900)).toBeUndefined();
    expect(
      renderOrder(segs, 400)
        // Just behind the playhead comes before far ahead.
        .slice(0, 4)
        .map((x) => x.from),
    ).toEqual([360, 420, 480, 300]);
    const cached = new Set([segs[0]!.key, segs[1]!.key]);
    expect(coverage(segs, (k) => cached.has(k))).toEqual([
      { from: 0, to: 120, state: 'cached' },
      { from: 120, to: 900, state: 'uncached' },
    ]);
  });

  it('formats and cached pictures', () => {
    const seq = { width: 3840, height: 2160 };
    expect(formatFor({ size: 'viewer', high: false }, seq)).toEqual({ height: 1080, high: false });
    expect(formatFor({ size: 'half', high: true }, seq)).toEqual({ height: 1080, high: true });
    expect(formatFor({ size: 'full', high: false }, seq).height).toBe(2160);
    const p = project();
    const s = seqOf(p);
    const seg = keysOf(p)[1]!;
    const ops = cachedOps(s, seg, '/c/x.mp4', 75, FMT);
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    expect(op.kind).toBe('layer');
    if (op.kind !== 'layer' || op.layer.source?.kind !== 'video') throw new Error('not a video layer');
    expect(op.layer.source.time).toBeCloseTo(15 / 30);
    expect(op.layer.source.media.path).toBe('/c/x.mp4');
    expect(op.layer.motion.fill).toBe(true);
    // The same objects every time (playback keeps its video element).
    const again = cachedOps(s, seg, '/c/x.mp4', 76, FMT)[0];
    if (again?.kind !== 'layer' || again.layer.source?.kind !== 'video') throw new Error('not a video layer');
    expect(again.layer.source.media).toBe(op.layer.source.media);
  });
});
