import { describe, expect, test } from 'vitest';
import { defaultOptions } from './plan';
import { buildJson, buildMarkdown, everyFive, perStep, reportName, type ReportData } from './report';
import { judge, type Measured } from './verdict';
import { goodRun, sample } from './testdata';

function data(m: Measured): ReportData {
  return {
    meta: {
      appVersion: '1.4.0',
      build: 'production',
      startedAt: Date.UTC(2026, 9, 6, 14, 5),
      finishedAt: Date.UTC(2026, 9, 6, 14, 7),
      system: { os: 'Windows 11 Pro', arch: 'x86_64', cpu: 'Intel Core i7', cores: 16, memTotalMb: 32000, ffmpeg: true },
      options: defaultOptions(),
      settings: { quality: '1080p', videoKbps: 6000, audioKbps: 160, recordMix: 'stream', iso: true, chapters: true, destinations: ['YouTube'] },
      inputs: [{ id: 'test-camera-1', kind: 'camera', name: 'Logitech BRIO' }],
      skipped: [{ what: 'Microphones', why: 'No microphone was found on this computer.' }],
    },
    measured: m,
    judged: judge(m),
  };
}

describe('the report', () => {
  test('two layers: the owner’s summary first, then the developer’s details', () => {
    const md = buildMarkdown(data(goodRun()));
    const order = [
      '**Verdict: YES**',
      '## Problems',
      '## Advice',
      '## At a glance',
      '## Output screens',
      '## Streaming',
      '## Recording',
      '# Technical details (for the developer)',
      '## App and computer',
      '## Test settings',
      '## Timeline',
      '## Measurements per step',
      '## Samples (every 5 s)',
      '## Problem center',
      '## Console errors and warnings',
      '## FFmpeg checks',
    ];
    let last = -1;
    for (const h of order) {
      const i = md.indexOf(h);
      expect(i, h).toBeGreaterThan(last);
      last = i;
    }
    expect(md).toContain('Windows 11 Pro');
    expect(md).toContain('1.4.0 (production)');
    expect(md).toContain('Microphones: No microphone was found');
  });

  test('problems are listed most serious first, each with where to look', () => {
    const m = goodRun({ extraDisplays: 0, diskMBps: 1 });
    m.outputs[0] = { ...m.outputs[0]!, inSync: false };
    const md = buildMarkdown(data(m));
    const crit = md.indexOf('CRITICAL — The recording drive is too slow');
    const prob = md.indexOf('PROBLEM — The Live Screen output was out of step with Program');
    const note = md.indexOf('NOTE — No extra screens connected');
    expect(crit).toBeGreaterThan(0);
    expect(prob).toBeGreaterThan(crit);
    expect(note).toBeGreaterThan(prob);
    expect(md).toContain('Likely cause / where to look: Output windows: app/src/views/OutputView.tsx');
    expect(md).toContain('**Verdict: NO**');
    expect(md).toContain('No extra screens connected — outputs tested as windows on the main screen.');
  });

  test('failures carry the exact error and stack', () => {
    const m = goodRun({
      steps: [
        {
          kind: 'countdown',
          label: 'Countdown to zero',
          round: 0,
          at: 61_000,
          ms: 12_000,
          ok: false,
          error: 'Timed out: the countdown',
          stack: 'Error: Timed out\n    at run (runner.ts:10:5)',
          notes: [],
        },
      ],
    });
    const md = buildMarkdown(data(m));
    expect(md).toContain('## Failures');
    expect(md).toContain('### Countdown to zero (at 01:01, round 1)');
    expect(md).toContain('at run (runner.ts:10:5)');
    expect(md).toContain('crates/engine/src/timing.rs');
  });

  test('private things never get into the report', () => {
    const m = goodRun({
      recording: { file: 'C:\\Users\\dana\\Videos\\Lumora\\Gala.mkv', probe: null, seconds: 10, error: 'x' },
      console: [
        '12:00 ERROR could not open /home/dana/secret/plan.mp4 for dana@example.com',
        '12:01 WARN rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop-qrst failed',
      ],
      captureFailures: ['stream (session 4): rtmp://live.twitch.tv/app/live_123456_AbCdEf failed stream_key=hunter2'],
      problems: [{ level: 'error', title: 'Could not save', detail: 'password: hunter2', at: 1 }],
    });
    const d = data(m);
    const md = buildMarkdown(d);
    const json = buildJson(d);
    for (const text of [md, json]) {
      expect(text).not.toContain('dana');
      expect(text).not.toContain('abcd-efgh');
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('live_123456');
      expect(text).not.toContain('example.com');
      expect(text).not.toMatch(/Users[\\/]/);
    }
    expect(md).toContain('Gala.mkv');
    expect(md).toContain('plan.mp4');
    expect(md).toContain('rtmp://a.rtmp.youtube.com/<hidden>');
  });

  test('the JSON twin has the same verdict, findings and per-step numbers', () => {
    const m = goodRun({ extraDisplays: 0 });
    const j = JSON.parse(buildJson(data(m)));
    expect(j.kind).toBe('lumora-test-report');
    expect(j.verdict).toBe('yes');
    expect(j.findings[0].severity).toBe('note');
    expect(j.findings[0].where).toMatch(/OutputView\.tsx/);
    expect(j.measured.perStep[0].step).toBe('cuts');
    expect(j.measured.samples).toHaveLength(120);
  });

  test('samples every five seconds, and per step', () => {
    const s = Array.from({ length: 21 }, (_, i) => sample(i * 1000, { step: i < 10 ? 'cuts' : 'background', dropped: i }));
    expect(everyFive(s).map((x) => x.t)).toEqual([0, 5000, 10_000, 15_000, 20_000]);
    const p = perStep(s);
    expect(p.map((x) => x.step)).toEqual(['cuts', 'background']);
    expect(p[0]!.dropped).toBe(9);
    expect(p[1]!.seconds).toBe(10);
  });

  test('the file name', () => {
    expect(reportName(new Date(2026, 9, 6, 9, 5))).toBe('Lumora test report 2026-10-06 09.05');
  });
});
