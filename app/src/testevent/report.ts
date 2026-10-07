// The test event's report: one Markdown file with two layers — a summary
// the owner reads (verdict, problems, advice) and the full technical details
// a developer needs to fix each problem — plus a JSON twin for machines.
// Everything that came from outside Lumora's own words is cleaned first
// (../reports/scrub.ts): no stream keys, passwords, emails or folders.

import { engineRows } from './engineReport';
import { LIMITS, scrub } from '../reports/scrub';
import { LENGTHS, stepLabel, type PlannedInput, type Skipped, type TestOptions } from './plan';
import { OUTPUT_NAMES, VERDICT_WORDS, type Finding, type Measured, type Sample, type Stats, type Verdict, type Phase } from './verdict';

export interface SystemInfo {
  os: string;
  arch: string;
  cpu: string;
  cores: number;
  memTotalMb: number;
  ffmpeg: boolean;
}

/** The recording and streaming settings in effect (no keys: destination names only). */
export interface SettingsShown {
  quality: string;
  videoKbps: number;
  audioKbps: number;
  recordMix: string;
  iso: boolean;
  chapters: boolean;
  destinations: string[];
  /** Encoder choice, speed/quality, stream picture, recordings encoded again. */
  encoder?: string;
  preset?: string;
  streamQuality?: string | null;
  recordEncode?: boolean;
}

export interface ReportMeta {
  appVersion: string;
  build: string;
  startedAt: number;
  finishedAt: number;
  system: SystemInfo | null;
  /** The system check's findings, when that check has run (any extra lines). */
  systemCheck?: string[];
  options: TestOptions;
  settings: SettingsShown | null;
  inputs: PlannedInput[];
  skipped: Skipped[];
}

export interface Judged {
  verdict: Verdict;
  findings: Finding[];
  advice: string[];
  stats: Stats;
}

export interface ReportData {
  meta: ReportMeta;
  measured: Measured;
  judged: Judged;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "Lumora test report 2026-10-06 14.05" (local time). */
export function reportName(at: Date): string {
  return `Lumora test report ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}`;
}

const clean = (t: unknown, max: number = LIMITS.message) => scrub(t, max);
/** Text for a Markdown table cell. */
const cell = (t: unknown) =>
  String(t ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
const n = (x: number | null | undefined, unit = '') => (x === null || x === undefined ? '–' : `${x}${unit}`);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const SEVERITY_WORDS = { critical: 'CRITICAL', problem: 'PROBLEM', note: 'NOTE' } as const;

function phaseLabel(p: Phase): string {
  return p === 'setup' ? 'Setting up' : p === 'finish' ? 'Finishing' : stepLabel(p);
}

/** The samples, one every `everyMs` (the closest to each mark). */
export function everyFive(samples: Sample[], everyMs = 5000): Sample[] {
  const out: Sample[] = [];
  let next = samples[0]?.t ?? 0;
  for (const s of samples) {
    if (s.t >= next) {
      out.push(s);
      next = s.t + everyMs;
    }
  }
  return out;
}

/** Each step's measurements: frame rate, dropped frames, processor, encoder. */
export function perStep(
  samples: Sample[],
): { step: Phase; seconds: number; fpsAvg: number | null; fpsMin: number | null; cpuMax: number | null; recSpeedMin: number | null; dropped: number }[] {
  const order: Phase[] = [];
  const by = new Map<Phase, Sample[]>();
  for (const s of samples) {
    if (!by.has(s.step)) {
      by.set(s.step, []);
      order.push(s.step);
    }
    by.get(s.step)!.push(s);
  }
  return order.map((step) => {
    const xs = by.get(step)!;
    const v = (f: (s: Sample) => number | null) => xs.map(f).filter((x): x is number => x !== null);
    const fps = v((s) => s.fps);
    const cpu = v((s) => s.cpu);
    const sp = v((s) => s.recSpeed);
    let dropped = 0;
    for (let i = 1; i < xs.length; i++) {
      const a = xs[i - 1]!.dropped;
      const b = xs[i]!.dropped;
      if (a !== null && b !== null) dropped += b >= a ? b - a : b;
    }
    return {
      step,
      seconds: xs.length > 1 ? Math.round((xs.at(-1)!.t - xs[0]!.t) / 1000) : 1,
      fpsAvg: fps.length ? Math.round((fps.reduce((a, b) => a + b, 0) / fps.length) * 10) / 10 : null,
      fpsMin: fps.length ? Math.min(...fps) : null,
      cpuMax: cpu.length ? Math.round(Math.max(...cpu)) : null,
      recSpeedMin: sp.length ? Math.round(Math.min(...sp) * 100) / 100 : null,
      dropped,
    };
  });
}

function table(head: string[], rows: unknown[][]): string {
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

function code(text: string): string {
  return ['```', text.replace(/```/g, "'''"), '```'].join('\n');
}

/** The report as Markdown: the summary first, then the developer's details. */
/** The encoders in use, for the at-a-glance table. */
export function encoderRows(e: Measured['encoders']): string[][] {
  if (!e) return [];
  const rows = [
    ['Graphics-card encoders found', e.hardware.length ? e.hardware.join(', ') : 'none (the processor encodes)'],
    ['Recording encoder', e.recording ?? '–'],
    ['Stream encoder', e.stream ?? '–'],
  ];
  if (e.vertical) rows.push(['Vertical stream encoder', e.vertical]);
  if (e.failed.length) rows.push(['Graphics-card encoder failed (fell back to the processor)', e.failed.join(', ')]);
  return rows;
}

export function buildMarkdown(d: ReportData): string {
  const { meta, measured: m, judged: j } = d;
  const st = j.stats;
  const when = new Date(meta.startedAt);
  const v = VERDICT_WORDS[j.verdict];
  const out: string[] = [];
  const h = (t: string) => out.push('', t, '');
  out.push(`# ${reportName(when)}`);
  out.push('');
  out.push(`**Verdict: ${v.word}** — ${v.line}`);
  out.push('');
  out.push(
    `${LENGTHS[meta.options.length].name} test, ${clock(m.ms)} long${m.stopped ? ' (stopped early)' : ''}. Lumora ${clean(meta.appVersion)} on ${clean(meta.system?.os ?? 'this computer')}.`,
  );

  h('## Problems');
  if (!j.findings.length) out.push('None found.');
  j.findings.forEach((f, i) => {
    out.push(`${i + 1}. **${SEVERITY_WORDS[f.severity]} — ${clean(f.title)}** (${f.area})`);
    if (f.detail) out.push(`   - What happened: ${clean(f.detail, LIMITS.stack)}`);
    out.push(`   - What to do: ${f.advice}`);
    out.push(`   - Likely cause / where to look: ${f.where}`);
  });

  h('## Advice');
  const adviceLines = [...j.findings.filter((f) => f.severity !== 'note').map((f) => f.advice), ...j.advice];
  out.push(...(adviceLines.length ? [...new Set(adviceLines)].map((a) => `- ${clean(a)}`) : ['- Nothing to change.']));

  h('## At a glance');
  out.push(
    table(
      ['Measure', 'Result'],
      [
        ['Frame rate (avg / min)', `${n(st.fpsAvg)} / ${n(st.fpsMin)} of ${n(st.target)} fps`],
        ['Dropped frames', n(st.droppedPct, '%')],
        ['Processor (max / avg)', `${n(st.cpuMax, '%')} / ${n(st.cpuAvg, '%')}`],
        ['Memory growth', n(st.memGrowthMb, ' MB')],
        ['Recording encoder speed (min / avg)', `${n(st.recSpeedMin, '×')} / ${n(st.recSpeedAvg, '×')}`],
        ['Stream encoder speed (min)', n(st.streamSpeedMin, '×')],
        ['Recording drive', `${n(st.diskMBps, ' MB/s')} (needs ${n(Math.round(m.neededMBps * 10) / 10, ' MB/s')})`],
        ...encoderRows(m.encoders),
        ...engineRows(m.engine),
      ],
    ),
  );

  if (m.outputsTested) {
    h('## Output screens');
    out.push(
      m.extraDisplays === 0 ? 'No extra screens connected — outputs tested as windows on the main screen.' : `${m.extraDisplays} extra screen(s) connected.`,
    );
    out.push('');
    out.push(
      table(
        ['Output', 'Result', 'Opened', 'Where', 'fps', 'In step', 'Black', 'Overlays', 'Tally'],
        m.outputs.map((o) => [
          OUTPUT_NAMES[o.output],
          outputOk(o) ? 'PASS' : 'FAIL',
          o.opened ? 'yes' : 'no',
          o.ownDisplay ? 'own screen, full screen' : 'window on the main screen',
          n(o.fps),
          yn(o.inSync),
          yn(o.black),
          yn(o.overlays),
          yn(o.tally),
        ]),
      ),
    );
    out.push('');
    out.push(`Full screen on the main display: ${m.fullscreenOk === null ? 'not tried' : m.fullscreenOk ? 'worked' : 'did not work'}.`);
  }

  if (m.streamTested || m.preflight.length) {
    h('## Streaming');
    if (m.streams.length)
      out.push(
        table(
          ['Stream', 'Result', 'Started', 'Seconds', 'Bitrate', 'Encoder min', 'Reconnects', 'Received'],
          m.streams.map((s) => [
            `${s.vertical ? 'Vertical' : 'Wide'} → ${s.local ? 'test receiver on this computer' : clean(s.name)}`,
            s.started && (!s.local || (s.probe?.frames ?? 0) > 0) && s.reconnects === 0 ? 'PASS' : 'FAIL',
            s.started ? 'yes' : 'no',
            s.seconds,
            s.avgKbps ? `${Math.round(s.avgKbps)} kbit/s` : '–',
            n(s.minSpeed, '×'),
            s.reconnects,
            s.probe
              ? `${s.probe.frames} frames, ${n(s.probe.seconds === null ? null : Math.round(s.probe.seconds), ' s')}, ${s.probe.audioStreams} sound`
              : '–',
          ]),
        ),
      );
    if (m.preflight.length) {
      out.push('');
      out.push('Your destinations (checked only — nothing was sent):');
      out.push('');
      for (const r of m.preflight)
        out.push(`- ${clean(r.name)}: ${r.reachable ? 'answered' : 'did not answer'}; ${r.hasKey ? 'stream key set' : 'no stream key'} — ${clean(r.message)}`);
    }
  }

  h('## Recording');
  const p = m.recording.probe;
  out.push(
    m.recording.file
      ? `${clean(m.recording.file)}: ${p ? `${p.frames} frames, ${n(p.seconds === null ? null : Math.round(p.seconds * 10) / 10, ' s')}, ${p.audioStreams} sound track(s), FFmpeg ${p.ok ? 'read it all' : 'found errors'}` : 'not checked'} (recorded for ${Math.round(m.recording.seconds)} s; the file was removed afterwards).`
      : `No recording: ${clean(m.recording.error ?? 'unknown')}`,
  );

  out.push('', '---', '', '# Technical details (for the developer)');

  h('## App and computer');
  out.push(
    table(
      ['', ''],
      [
        ['Lumora', `${clean(meta.appVersion)} (${clean(meta.build)})`],
        ['Started', new Date(meta.startedAt).toISOString()],
        ['Finished', new Date(meta.finishedAt).toISOString()],
        ['Operating system', clean(meta.system?.os ?? '–')],
        ['Processor', `${clean(meta.system?.cpu ?? '–')} (${meta.system?.cores ?? '?'} threads, ${meta.system?.arch ?? '?'})`],
        ['Memory', n(meta.system?.memTotalMb ?? null, ' MB')],
        ['FFmpeg', meta.system ? (meta.system.ffmpeg ? 'found' : 'not found') : '–'],
        ['Extra displays', m.outputsTested ? m.extraDisplays : 'not checked'],
        ['Your event put back', m.restored === null ? 'not needed' : m.restored ? 'yes, exactly' : 'NO (kept for the next start)'],
      ],
    ),
  );
  if (meta.systemCheck?.length) {
    out.push('', 'From the system check:', '');
    out.push(...meta.systemCheck.map((l) => `- ${clean(l)}`));
  }

  h('## Test settings');
  const o = meta.options;
  out.push(
    table(
      ['Setting', 'Value'],
      [
        ['Length', `${LENGTHS[o.length].name} (${LENGTHS[o.length].minutes} min)`],
        ['Cameras and microphones', o.devices ? 'used' : 'not used'],
        ['Output screens', o.outputs ? 'tested' : 'not tested'],
        ['Stream test (to this computer)', o.stream ? 'on' : 'off'],
        ['Test to my own destination', o.realDestination ? 'yes (confirmed)' : 'no'],
        ['Recorded to', o.userDrive ? 'the recording drive' : 'the temporary folder'],
      ],
    ),
  );
  if (meta.settings) {
    const s = meta.settings;
    out.push('', 'Recording and streaming settings in effect:', '');
    out.push(
      table(
        ['Setting', 'Value'],
        [
          ['Quality', s.quality],
          ['Video / sound bitrate', `${s.videoKbps} / ${s.audioKbps} kbit/s`],
          ['Recording mix', s.recordMix],
          ['Camera files (ISO)', s.iso ? 'on' : 'off'],
          ['Chapters', s.chapters ? 'on' : 'off'],
          ...(s.encoder
            ? [
                ['Encoder', `${s.encoder}${s.preset ? `, ${s.preset}` : ''}`],
                ['Stream picture', s.streamQuality ?? 'same as the recording'],
                ['Recordings encoded again', s.recordEncode ? 'yes' : 'no (saved as the app encodes them)'],
              ]
            : []),
          ['Destinations', s.destinations.length ? s.destinations.map((x) => clean(x)).join(', ') : 'none'],
        ],
      ),
    );
  }
  out.push('', 'Inputs added:', '');
  out.push(...meta.inputs.map((i) => `- ${i.kind}: ${clean(i.name)}`));
  if (meta.skipped.length) {
    out.push('', 'Left out:', '');
    out.push(...meta.skipped.map((s) => `- ${clean(s.what)}: ${clean(s.why)}`));
  }

  h('## Timeline');
  out.push(
    table(
      ['Time', 'Step', 'Round', 'Result', 'Took', 'Notes / error'],
      m.steps.map((s) => [
        clock(s.at),
        clean(s.label),
        s.round + 1,
        s.skipped ? 'skipped' : s.ok ? 'pass' : 'FAIL',
        secs(s.ms),
        clean([...s.notes, s.error ? `ERROR: ${s.error}` : ''].filter(Boolean).join('; '), LIMITS.stack),
      ]),
    ),
  );
  const failed = m.steps.filter((s) => !s.ok && !s.skipped);
  if (failed.length) {
    h('## Failures');
    for (const s of failed) {
      out.push(`### ${clean(s.label)} (at ${clock(s.at)}, round ${s.round + 1})`, '');
      out.push(code(clean(`${s.error ?? 'failed'}\n${s.stack ?? ''}`, LIMITS.stack)));
      out.push('');
    }
  }

  h('## Measurements per step');
  out.push(
    table(
      ['Step', 'Seconds', 'fps avg', 'fps min', 'Dropped', 'CPU max', 'Encoder min'],
      perStep(m.samples).map((r) => [phaseLabel(r.step), r.seconds, n(r.fpsAvg), n(r.fpsMin), r.dropped, n(r.cpuMax, '%'), n(r.recSpeedMin, '×')]),
    ),
  );
  if (j.stats.features.length) {
    out.push('', `Heavier features compared with the rest of the show (${n(st.baseline.fpsAvg)} fps, ${n(st.baseline.droppedPct, '%')} dropped):`, '');
    out.push(...j.stats.features.map((f) => `- ${phaseLabel(f.step)}: ${n(f.fpsAvg)} fps, ${n(f.droppedPct, '%')} dropped`));
  }

  h('## Samples (every 5 s)');
  out.push(
    table(
      ['Time', 'Step', 'fps', 'Dropped (total)', 'Rec speed', 'Stream speed', 'Rec MB', 'CPU', 'RAM used', 'Lumora MB', 'Window MB', 'Mic peak'],
      everyFive(m.samples).map((s) => [
        clock(s.t),
        phaseLabel(s.step),
        n(s.fps),
        n(s.dropped),
        n(s.recSpeed === null ? null : Math.round(s.recSpeed * 100) / 100),
        n(s.streamSpeed === null ? null : Math.round(s.streamSpeed * 100) / 100),
        n(s.recBytes === null ? null : Math.round(s.recBytes / 1e5) / 10),
        n(s.cpu === null ? null : Math.round(s.cpu)),
        n(s.memUsedMb),
        n(s.appMemMb),
        n(s.jsHeapMb),
        n(Object.values(s.mics).length ? Math.round(Math.max(...Object.values(s.mics)) * 100) / 100 : null),
      ]),
    ),
  );

  h('## Problem center');
  out.push(
    ...(m.problems.length
      ? m.problems.map((p) => `- [${clock(p.at)}] ${p.level.toUpperCase()}: ${clean(p.title)}${p.detail ? ` — ${clean(p.detail)}` : ''}`)
      : ['Nothing was reported.']),
  );

  h('## Console errors and warnings');
  out.push(m.console.length ? code(m.console.map((l) => clean(l, LIMITS.line)).join('\n')) : 'None.');

  if (m.captureFailures.length) {
    h('## Recording and streaming failures (FFmpeg)');
    out.push(code(m.captureFailures.map((l) => clean(l, LIMITS.stack)).join('\n\n')));
  }

  h('## FFmpeg checks');
  if (p) out.push('Recording:', '', code(clean(p.text, LIMITS.stack)), '');
  for (const s of m.streams) if (s.probe) out.push(`${s.vertical ? 'Vertical' : 'Wide'} stream as received:`, '', code(clean(s.probe.text, LIMITS.stack)), '');
  for (const s of m.streams) if (s.error) out.push(`${s.vertical ? 'Vertical' : 'Wide'} stream error: ${clean(s.error, LIMITS.stack)}`, '');
  if (!p && !m.streams.some((s) => s.probe)) out.push('None.');

  h('## Rust log');
  out.push('Lumora’s own log (the Rust side) is not collected by the test; run Lumora from a terminal to see it.');
  out.push('');
  return out.join('\n');
}

const yn = (b: boolean | null) => (b === null ? '–' : b ? 'yes' : 'no');

export function outputOk(o: Measured['outputs'][number]): boolean {
  return o.opened && o.fps !== null && o.fps >= 20 && o.inSync !== false && o.black !== true && o.overlays !== false;
}

/** Cleans every string in a value (for the JSON twin). */
export function scrubDeep(v: unknown): unknown {
  if (typeof v === 'string') return scrub(v, LIMITS.stack);
  if (Array.isArray(v)) return v.map(scrubDeep);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, k === 'where' || k === 'advice' ? x : scrubDeep(x)]));
  return v;
}

/** The JSON twin: everything, cleaned. */
export function buildJson(d: ReportData): string {
  return JSON.stringify(
    scrubDeep({
      kind: 'lumora-test-report',
      version: 1,
      verdict: d.judged.verdict,
      findings: d.judged.findings,
      advice: d.judged.advice,
      stats: d.judged.stats,
      meta: d.meta,
      measured: { ...d.measured, perStep: perStep(d.measured.samples) },
    }),
    null,
    1,
  );
}
