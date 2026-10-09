import { describe, expect, it } from 'vitest';
import { newProject } from './build';
import { clipCueEvents, cueEvents, cueGain, cueMixes, straightCueEvents } from './cues';
import { readProject } from './validate';
import type { Composition, CueMarker, TitleProject } from './types';

/** An 8 s title: IN 0–1, HOLD 1–6, OUT 6–8, with sounds on cues. */
function titled(cues: Omit<CueMarker, 'id' | 'name'>[], loop: Composition['markers']['loop'] = null): { p: TitleProject; c: Composition } {
  const p = newProject();
  const c = p.compositions[0]!;
  c.duration = 8;
  c.fps = 30;
  c.markers = { inEnd: 1, outStart: 6, loop };
  c.cues = cues.map((q, i) => ({ id: `q${i}`, name: `Cue ${i}`, ...q }));
  p.assets.push({ id: 'whoosh', name: 'Whoosh', kind: 'audio', src: 'data:audio/wav;base64,' });
  return { p, c };
}

const at = (es: { at: number }[]) => es.map((e) => +e.at.toFixed(4));

describe('audio cue timing', () => {
  it('IN, HOLD and OUT cues play at their place from the take and from taking off', () => {
    const { p, c } = titled([
      { t: 0.5, sound: 'whoosh' },
      { t: 3, sound: 'whoosh' },
      { t: 6.25, sound: 'whoosh' },
      { t: 2, sound: null },
      { t: 2.5, sound: 'missing' },
    ]);
    // Taken at 100 s, off at 120 s.
    expect(at(cueEvents(p, c, 100, 120, 0, 1000))).toEqual([100.5, 103, 120.25]);
    // Still on air: the OUT's cue waits.
    expect(at(cueEvents(p, c, 100, null, 0, 1000))).toEqual([100.5, 103]);
    // Only the window asked for (the scheduler looks a little ahead each time).
    expect(at(cueEvents(p, c, 100, 120, 100.4, 100.6))).toEqual([100.5]);
    expect(at(cueEvents(p, c, 100, 120, 100.6, 102.9))).toEqual([]);
  });

  it('taken off during the IN: what was cut short does not play, the OUT plays from then', () => {
    const { p, c } = titled([
      { t: 0.5, sound: 'whoosh' },
      { t: 0.9, sound: 'whoosh' },
      { t: 7, sound: 'whoosh' },
    ]);
    expect(at(cueEvents(p, c, 10, 10.7, 0, 100))).toEqual([10.5, 11.7]);
  });

  it('a cue inside the loop plays every time round, frame-exact', () => {
    const { p, c } = titled([{ t: 2.5, sound: 'whoosh' }, { t: 1.5, sound: 'whoosh' }], { start: 2, end: 4 });
    const es = at(cueEvents(p, c, 0, 9, 0, 100));
    // 1.5 before the loop: once; 2.5 in the loop: 2.5, 4.5, 6.5, 8.5 (until taken off at 9).
    expect(es).toEqual([1.5, 2.5, 4.5, 6.5, 8.5]);
    // Each within a frame of where the picture is at that cue.
    for (const e of cueEvents(p, c, 0, 9, 0, 100)) expect(Math.abs(e.at - Math.round(e.at * 30) / 30)).toBeLessThan(1 / 30);
  });

  it('a title clip in an edit: the OUT ends with the clip', () => {
    const { p, c } = titled([
      { t: 0.5, sound: 'whoosh' },
      { t: 6.5, sound: 'whoosh' },
    ]);
    // A 10 s clip: OUT starts at 8 s.
    expect(at(clipCueEvents(p, c, 10))).toEqual([0.5, 8.5]);
    // A 1.5 s clip: the OUT starts at the IN’s end (1 s), so its cue at 1.5 s would be the clip’s end: not played.
    expect(at(clipCueEvents(p, c, 1.5))).toEqual([0.5]);
  });

  it('played straight through (the designer render) and the mixes a cue goes to', () => {
    const { p, c } = titled([
      { t: 0.5, sound: 'whoosh' },
      { t: 6.5, sound: 'whoosh', mixes: ['hall', 'recording'], gain: -6 },
    ]);
    expect(at(straightCueEvents(p, c, 0, 8))).toEqual([0.5, 6.5]);
    expect(at(straightCueEvents(p, c, 1, 8))).toEqual([5.5]);
    expect(cueMixes(c.cues[0]!)).toEqual(['stream']);
    expect(cueMixes(c.cues[1]!)).toEqual(['hall', 'recording']);
    expect(cueMixes({ mixes: [] })).toEqual([]);
    expect(cueGain(c.cues[1]!)).toBeCloseTo(0.501, 2);
  });

  it('a project read from a file keeps only known mixes', () => {
    const { p } = titled([{ t: 1, sound: 'whoosh', mixes: ['hall', 'nope' as never], gain: 99 }]);
    const r = readProject(JSON.parse(JSON.stringify(p)));
    const q = r.project!.compositions[0]!.cues[0]!;
    expect(q.mixes).toEqual(['hall']);
    expect(q.gain).toBe(12);
  });
});
