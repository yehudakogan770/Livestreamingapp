import { describe, expect, it } from 'vitest';
import { buildEventProject, type Prepared } from '../model/build';
import type { EventFile } from '../model/event';
import { current, end, onTrack } from '../model/seq';
import { applyShots, detectSpeakers, guessWide, micSources, OVERLAP, planCuts, rulesForPacing, SILENCE, type CutRules, type Shot } from './autocam';
import { envelope } from './envelope';

const HOP = 0.1;
/** An envelope from [from, to, dB] pieces (seconds), quiet room (-70 dB) elsewhere. */
function env(seconds: number, parts: [number, number, number][]): Float32Array {
  const e = new Float32Array(Math.round(seconds / HOP)).fill(-70);
  for (const [a, b, db] of parts) e.fill(db, Math.round(a / HOP), Math.round(b / HOP));
  return e;
}
const at = (who: Int16Array, sec: number) => who[Math.round(sec / HOP)];

describe('who is talking', () => {
  // A talks 0–5 s, B 5–10 s (each heard faintly in the other's mic), both at once 12–14 s, then a cough from B.
  const a = env(20, [
    [0, 5, -20],
    [5, 10, -45],
    [12, 14, -22],
  ]);
  const b = env(20, [
    [0, 5, -44],
    [5, 10, -21],
    [12, 14, -21],
    [17, 17.2, -15],
  ]);
  const who = detectSpeakers([a, b]);

  it('picks the loudest microphone over the bleed', () => {
    expect(at(who, 2)).toBe(0);
    expect(at(who, 7)).toBe(1);
  });
  it('hears people talking at once, and silence', () => {
    expect(at(who, 13)).toBe(OVERLAP);
    expect(at(who, 11)).toBe(SILENCE);
  });
  it('ignores a cough', () => {
    expect(at(who, 17.1)).toBe(SILENCE);
  });
  it('bridges short pauses between words', () => {
    const c = env(10, [
      [0, 2, -20],
      [2.3, 5, -20],
    ]);
    const w = detectSpeakers([c]);
    expect(at(w, 2.1)).toBe(0);
  });
});

/** A who-is-talking list from [seconds, who] stretches. */
function talk(parts: [number, number][]): Int16Array {
  const total = parts.reduce((s, [d]) => s + d, 0);
  const out = new Int16Array(Math.round(total / HOP));
  let i = 0;
  for (const [d, w] of parts) {
    const n = Math.round(d / HOP);
    out.fill(w, i, i + n);
    i += n;
  }
  return out;
}

const RULES: CutRules = { minShot: 2, maxShot: 12, cutaway: 3, silenceToWide: 3, wide: 'wide' };
const lengths = (shots: Shot[]) => shots.map((s) => +(s.to - s.from).toFixed(2));

describe('the cuts', () => {
  it('cuts to each speaker', () => {
    const shots = planCuts(
      talk([
        [5, 0],
        [6, 1],
      ]),
      HOP,
      ['a', 'b'],
      RULES,
    );
    expect(shots.map((s) => [s.from, +s.to.toFixed(1), s.angle])).toEqual([
      [0, 5, 'a'],
      [5, 11, 'b'],
    ]);
  });

  it('never cuts faster than the shortest shot (no flicker)', () => {
    const parts: [number, number][] = [];
    for (let i = 0; i < 20; i++) parts.push([0.5 + (i % 3) * 0.3, i % 2]);
    const shots = planCuts(talk(parts), HOP, ['a', 'b'], RULES);
    expect(Math.min(...lengths(shots))).toBeGreaterThanOrEqual(RULES.minShot - 1e-9);
    // Neighbors are always different cameras.
    shots.slice(1).forEach((s, i) => expect(s.angle).not.toBe(shots[i]?.angle));
  });

  it('goes wide when people talk at once or nobody talks for a while', () => {
    const shots = planCuts(
      talk([
        [4, 0],
        [3, OVERLAP],
        [4, 1],
        [5, SILENCE],
        [4, 0],
      ]),
      HOP,
      ['a', 'b'],
      RULES,
    );
    expect(shots.map((s) => [s.angle, s.why])).toEqual([
      ['a', 'speaker'],
      ['wide', 'overlap'],
      ['b', 'speaker'],
      ['wide', 'silence'],
      ['a', 'speaker'],
    ]);
  });

  it('stays on the speaker through a short pause', () => {
    const shots = planCuts(
      talk([
        [4, 0],
        [1, SILENCE],
        [4, 0],
      ]),
      HOP,
      ['a', 'b'],
      RULES,
    );
    expect(shots).toHaveLength(1);
    expect(shots[0]?.angle).toBe('a');
  });

  it('without a wide camera, keeps the last speaker when people talk at once', () => {
    const shots = planCuts(
      talk([
        [4, 0],
        [3, OVERLAP],
        [4, 1],
      ]),
      HOP,
      ['a', 'b'],
      { ...RULES, wide: null },
    );
    expect(shots.map((s) => [s.angle, +s.to.toFixed(1)])).toEqual([
      ['a', 7],
      ['b', 11],
    ]);
  });

  it('breaks up a long monologue with cutaways, every part still long enough', () => {
    const shots = planCuts(talk([[40, 0]]), HOP, ['a'], RULES);
    expect(shots.filter((s) => s.why === 'cutaway').length).toBeGreaterThanOrEqual(2);
    expect(shots.every((s) => s.to - s.from >= RULES.minShot - 1e-9)).toBe(true);
    expect(shots.filter((s) => s.angle === 'a').every((s) => s.to - s.from <= RULES.maxShot + 1e-9)).toBe(true);
    expect(shots[0]?.from).toBe(0);
    expect(shots[shots.length - 1]?.to).toBeCloseTo(40);
  });

  it('cuts more often at a faster pacing', () => {
    const parts: [number, number][] = [];
    for (let i = 0; i < 30; i++) parts.push([1.5 + (i % 4) * 0.7, i % 2]);
    const w = talk(parts);
    const calm = planCuts(w, HOP, ['a', 'b'], rulesForPacing(0, 'wide'));
    const fast = planCuts(w, HOP, ['a', 'b'], rulesForPacing(1, 'wide'));
    expect(fast.length).toBeGreaterThan(calm.length);
  });

  it('ignores microphones with no camera', () => {
    const shots = planCuts(
      talk([
        [4, 0],
        [4, 1],
      ]),
      HOP,
      ['a', null],
      RULES,
    );
    expect(shots).toHaveLength(1);
    expect(shots[0]?.angle).toBe('a');
    expect(shots[0]?.to).toBeCloseTo(8);
  });
});

describe('in the timeline', () => {
  const event: EventFile = {
    app: 'Lumora',
    version: 1,
    name: 'Panel',
    startedAt: 0,
    durationMs: 30000,
    program: { path: null, mp4: null },
    files: [
      { kind: 'camera', sourceId: 'c1', name: 'Wide', path: '/e/wide.mp4', startMs: 0 },
      { kind: 'camera', sourceId: 'c2', name: 'Dana', path: '/e/dana.mp4', startMs: 0 },
      { kind: 'camera', sourceId: 'c3', name: 'Sam', path: '/e/sam.mp4', startMs: 0 },
      { kind: 'microphone', sourceId: 'm1', name: 'Sam (sound)', path: '/e/sam.wav', startMs: 1000 },
      { kind: 'microphone', sourceId: 'm2', name: 'Dana (sound)', path: '/e/dana.wav', startMs: 0 },
    ],
    cuts: [{ at: 0, id: 'c1', name: 'Wide' }],
  };
  const prep = (path: string, video: boolean): Prepared => ({ path, durationMs: 30000, hasVideo: video, hasAudio: true, width: 1920, height: 1080 });
  const media = new Map(['/e/wide.mp4', '/e/dana.mp4', '/e/sam.mp4', '/e/sam.wav', '/e/dana.wav'].map((p) => [p, prep(p, p.endsWith('.mp4'))]));
  const p = buildEventProject(event, '/e/Panel.lumora', media);
  const s = current(p);
  const g = p.groups[0]!;

  it('finds each microphone, its camera and its place in time', () => {
    const mics = micSources(p, s, g);
    const byName = Object.fromEntries(mics.map((m) => [m.name, m]));
    expect(byName['Sam']?.angle).toBe(g.angles.find((a) => a.name === 'Sam')?.id);
    expect(byName['Sam']?.offset).toBeCloseTo(1);
    expect(byName['Dana']?.angle).toBe(g.angles.find((a) => a.name === 'Dana')?.id);
    expect(guessWide(g)).toBe(g.angles.find((a) => a.name === 'Wide')?.id);
  });

  it('reads a microphone on the group time', () => {
    const peaks = new Uint8Array(3000).fill(200);
    // Sam's file starts 1 s into the event: before that, silence.
    const e = envelope(peaks, -1, 0.5, 4);
    expect(e[0]).toBe(-100);
    expect(e[2]).toBeGreaterThan(-10);
  });

  it('cuts the clip and its sound, each part its own camera and link', () => {
    const dana = g.angles.find((a) => a.name === 'Dana')!.id;
    const sam = g.angles.find((a) => a.name === 'Sam')!.id;
    const shots: Shot[] = [
      { from: 0, to: 10, angle: dana, why: 'speaker' },
      { from: 10, to: 20, angle: sam, why: 'speaker' },
      // The group runs 31 s (Sam's microphone started a second late).
      { from: 20, to: 31, angle: dana, why: 'speaker' },
    ];
    const q = applyShots(p, g.id, shots);
    const t = current(q);
    const v = onTrack(t, t.tracks[0]!.id);
    expect(v.map((c) => [c.start, end(c), c.source.kind === 'multicam' ? c.source.angle : '', c.name])).toEqual([
      [0, 300, dana, 'Dana'],
      [300, 600, sam, 'Sam'],
      [600, 930, dana, 'Dana'],
    ]);
    // The sound is cut at the same frames, and stays with its picture.
    for (const c of v) {
      const linked = t.clips.filter((x) => x.link === c.link && x.id !== c.id);
      expect(linked.length).toBeGreaterThan(0);
      for (const l of linked) expect(l.start).toBeGreaterThanOrEqual(c.start);
      for (const l of linked) expect(end(l)).toBeLessThanOrEqual(end(c));
    }
    // Sound continues where it was in the file.
    const samTrack = t.tracks.find((x) => x.name === 'Sam')!;
    const samClips = onTrack(t, samTrack.id);
    expect(samClips.map((c) => [c.start, c.source.kind === 'media' ? +c.source.in.toFixed(3) : 0])).toEqual([
      [30, 0],
      [300, 9],
      [600, 19],
    ]);
    // The original is untouched (undo keeps it).
    expect(onTrack(current(p), s.tracks[0]!.id)).toHaveLength(1);
  });

  it('only cuts between the in and out marks', () => {
    const marked = { ...p, sequences: p.sequences.map((x) => ({ ...x, inPoint: 300, outPoint: 600 })) };
    const sam = g.angles.find((a) => a.name === 'Sam')!.id;
    const q = applyShots(marked, g.id, [{ from: 0, to: 30, angle: sam, why: 'speaker' }]);
    const t = current(q);
    const v = onTrack(t, t.tracks[0]!.id);
    expect(v.map((c) => [c.start, c.source.kind === 'multicam' ? c.source.angle : ''])).toEqual([
      [0, 'cam1'],
      [300, sam],
      [600, 'cam1'],
    ]);
  });
});
