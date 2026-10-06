import { describe, expect, test } from 'vitest';
import { analyze, droppedPct, judge, sortFindings, verdictOf, type Measured } from './verdict';
import { goodRun, sample } from './testdata';

const titles = (m: Measured) => judge(m).findings.map((f) => f.title);

describe('measurements', () => {
  test('dropped frames are counted against the frames wanted, across a restart of drawing', () => {
    const s = [sample(0, { dropped: 0 }), sample(1000, { dropped: 3 }), sample(2000, { dropped: 1 }), sample(3000, { dropped: 1 })];
    // 3 + 1 (started again) + 0 of 90 frames wanted.
    expect(droppedPct(s)).toBeCloseTo((4 / 90) * 100);
    expect(droppedPct([sample(0, { dropped: null })])).toBeNull();
  });

  test('stats: frame rate, processor, memory growth, mic peaks', () => {
    const m = goodRun();
    m.samples[60] = sample(60_000, { fps: 12, cpu: 99 });
    m.samples = m.samples.map((s, i) => ({ ...s, appMemMb: 300 + i }));
    const st = analyze(m);
    expect(st.fpsMin).toBe(12);
    expect(st.cpuMax).toBe(99);
    expect(st.memGrowthMb).toBe(115);
    expect(st.micPeaks['test-mic-1']).toBe(0.2);
    expect(st.target).toBe(30);
  });

  test('heavy features are compared with the rest of the show', () => {
    const m = goodRun();
    m.samples = m.samples.map((s, i) =>
      i >= 50 && i < 60 ? { ...s, step: 'background' as const, fps: 18, dropped: (i - 49) * 10 } : i >= 60 ? { ...s, dropped: 100 } : s,
    );
    const st = analyze(m);
    const bg = st.features.find((f) => f.step === 'background')!;
    expect(bg.fpsAvg).toBe(18);
    expect(st.baseline.fpsAvg).toBe(30);
  });
});

describe('verdict and advice', () => {
  test('a good run: YES, with plain good news', () => {
    const j = judge(goodRun());
    expect(j.findings).toEqual([]);
    expect(j.verdict).toBe('yes');
    expect(j.advice.join(' ')).toMatch(/Recording drive kept up \(400 MB\/s/);
    expect(j.advice.join(' ')).toMatch(/went all the way through/);
  });

  test('a broken recording, a stream that never arrives or a core step failing: NO', () => {
    expect(judge(goodRun({ recording: { file: null, probe: null, seconds: 120, error: 'none' } })).verdict).toBe('no');
    const broken = goodRun();
    broken.recording = { ...broken.recording, probe: { frames: 0, seconds: null, video: false, audioStreams: 0, ok: false, text: 'Invalid data' } };
    expect(judge(broken).verdict).toBe('no');
    const lost = goodRun();
    lost.streams = [{ ...lost.streams[0]!, probe: { frames: 0, seconds: null, video: false, audioStreams: 0, ok: false, text: '' } }];
    expect(titles(lost)).toContain('The stream did not arrive');
    expect(
      judge(goodRun({ steps: [{ kind: 'panic', label: 'PANIC and recovery', round: 0, at: 0, ms: 1, ok: false, error: 'PANIC did not go off', notes: [] }] }))
        .verdict,
    ).toBe('no');
  });

  test('a slow picture or encoder', () => {
    const slow = goodRun({ samples: Array.from({ length: 60 }, (_, i) => sample(i * 1000, { fps: 20 })) });
    expect(judge(slow).verdict).toBe('no');
    const enc = goodRun({ samples: Array.from({ length: 60 }, (_, i) => sample(i * 1000, { recSpeed: i === 30 ? 0.7 : 1 })) });
    expect(titles(enc)).toContain('The recording fell behind for a moment');
    expect(judge(enc).verdict).toBe('risky');
  });

  test('background removal that drops frames: don’t use it on this computer', () => {
    const m = goodRun();
    m.samples = m.samples.map((s, i) =>
      i >= 50 && i < 60 ? { ...s, step: 'background' as const, fps: 22, dropped: (i - 49) * 4 } : i >= 60 ? { ...s, dropped: 40 } : s,
    );
    const j = judge(m);
    const f = j.findings.find((x) => x.title === 'Background removal dropped frames')!;
    expect(f.severity).toBe('problem');
    expect(f.advice).toBe('Don’t use background removal on this computer.');
    expect(f.where).toMatch(/vision\.ts/);
  });

  test('a slow drive, a silent microphone, memory that keeps growing', () => {
    expect(judge(goodRun({ diskMBps: 1 })).verdict).toBe('no');
    expect(titles(goodRun({ diskMBps: 2 }))).toContain('The recording drive is only just fast enough');
    const silent = goodRun();
    silent.samples = silent.samples.map((s) => ({ ...s, mics: { 'test-mic-1': 0 } }));
    expect(titles(silent)).toContain('No sound came from “USB mic”');
    const leak = goodRun({ ms: 30 * 60_000 });
    leak.samples = Array.from({ length: 1800 }, (_, i) => sample(i * 1000, { appMemMb: 300 + i }));
    expect(titles(leak)).toContain('Memory kept growing');
  });

  test('outputs: no extra screens is only a note; a black or stuck output is a problem', () => {
    const laptop = goodRun({ extraDisplays: 0 });
    const j = judge(laptop);
    expect(j.verdict).toBe('yes');
    expect(j.findings[0]!.title).toBe('No extra screens connected — outputs tested as windows on the main screen');
    const bad = goodRun();
    bad.outputs[1] = { ...bad.outputs[1]!, black: true, inSync: false };
    bad.outputs[2] = { ...bad.outputs[2]!, opened: false, error: 'no window' };
    const t = titles(bad);
    expect(t).toContain('The Back Screen output stayed black');
    expect(t).toContain('The Back Screen output was out of step with Program');
    expect(t).toContain('The stage Monitor did not open');
    expect(judge(bad).findings.find((f) => f.title === 'The stage Monitor did not open')!.where).toMatch(/outputs\.rs/);
  });

  test('destinations that can’t be reached, problems and console errors', () => {
    const m = goodRun({
      preflight: [{ name: 'YouTube', hasKey: true, reachable: false, message: 'did not answer' }],
      problems: [{ level: 'warning', title: 'Camera is busy', at: 1 }],
      console: ['12:00 ERROR boom'],
    });
    const j = judge(m);
    expect(j.verdict).toBe('risky');
    expect(j.findings.map((f) => f.severity)).toEqual(['problem', 'note', 'note']);
  });

  test('problems come first: critical, then problem, then note', () => {
    const f = (severity: 'critical' | 'problem' | 'note') => ({ severity, title: severity, detail: '', advice: '', where: '', area: '' });
    expect(sortFindings([f('note'), f('critical'), f('problem'), f('critical')]).map((x) => x.severity)).toEqual(['critical', 'critical', 'problem', 'note']);
    expect(verdictOf([f('note')])).toBe('yes');
    expect(verdictOf([f('note'), f('problem')])).toBe('risky');
    expect(verdictOf([f('problem'), f('critical')])).toBe('no');
  });

  test('not putting the event back is critical; stopping early is noted', () => {
    expect(judge(goodRun({ restored: false })).verdict).toBe('no');
    expect(titles(goodRun({ stopped: true }))).toContain('The test was stopped before the end');
  });
});
