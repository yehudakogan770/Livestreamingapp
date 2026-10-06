// The test event's judgment: what was measured → compact stats, the problems
// found (critical / problem / note, each with where a developer should look),
// plain-English advice, and the verdict for running a real event like this.

import type { StepKind } from './plan';

export type Phase = StepKind | 'setup' | 'finish';

/** One measurement, about once a second. */
export interface Sample {
  /** ms since the test started. */
  t: number;
  step: Phase;
  /** The recording picture's frames in the last second, and the frame rate wanted. */
  fps: number | null;
  target: number | null;
  /** Late (dropped) frames since drawing began (it can start again from 0). */
  dropped: number | null;
  /** How fast FFmpeg keeps up (1 = real time) for the recording and the stream. */
  recSpeed: number | null;
  streamSpeed: number | null;
  recBytes: number | null;
  streamBytes: number | null;
  cpu: number | null;
  memUsedMb: number | null;
  appMemMb: number | null;
  /** The control window's script memory (where the browser tells it). */
  jsHeapMb: number | null;
  /** Each microphone's level right now, 0 – 1. */
  mics: Record<string, number>;
}

export interface Probe {
  frames: number;
  seconds: number | null;
  video: boolean;
  audioStreams: number;
  ok: boolean;
  text: string;
}

export interface StepRecord {
  kind: Phase;
  label: string;
  round: number;
  /** ms since the test started. */
  at: number;
  ms: number;
  ok: boolean;
  /** Not run (stopped, or not possible here). */
  skipped?: boolean;
  error?: string;
  stack?: string;
  notes: string[];
}

export type OutputName = 'live' | 'back' | 'monitor' | 'multiview';

export interface OutputCheck {
  output: OutputName;
  opened: boolean;
  /** Full screen on its own display (else a small window on the main display). */
  ownDisplay: boolean;
  /** Frames the window drew per second. */
  fps: number | null;
  /** The input on air was the one drawn (in step with Program). */
  inSync: boolean | null;
  /** The picture was black while something was on air. */
  black: boolean | null;
  /** Overlays (names) showed while on. */
  overlays: boolean | null;
  /** Multiview: the red/green tally showed. */
  tally: boolean | null;
  error?: string;
}

export interface StreamCheck {
  name: string;
  vertical: boolean;
  /** To this computer's test receiver (else the person's own destination). */
  local: boolean;
  started: boolean;
  seconds: number;
  avgKbps: number | null;
  minSpeed: number | null;
  reconnects: number;
  probe: Probe | null;
  error?: string;
}

export interface Reach {
  name: string;
  hasKey: boolean;
  reachable: boolean;
  message: string;
}

export interface SeenProblem {
  level: 'error' | 'warning';
  title: string;
  detail?: string;
  at: number;
}

export interface Measured {
  /** ms the whole test took. */
  ms: number;
  samples: Sample[];
  steps: StepRecord[];
  outputsTested: boolean;
  outputs: OutputCheck[];
  extraDisplays: number;
  /** Full screen was tried on the main display: it worked (null: not tried). */
  fullscreenOk: boolean | null;
  streamTested: boolean;
  streams: StreamCheck[];
  preflight: Reach[];
  recording: { file: string | null; probe: Probe | null; seconds: number; error?: string };
  /** The recording drive's write speed, MB/s. */
  diskMBps: number | null;
  /** What the recording needs, MB/s. */
  neededMBps: number;
  userDrive: boolean;
  mics: { id: string; name: string }[];
  problems: SeenProblem[];
  console: string[];
  captureFailures: string[];
  /** The video encoders that did the work, and the graphics-card encoders found (and failed). */
  encoders?: { recording: string | null; stream: string | null; vertical: string | null; hardware: string[]; failed: string[] };
  /** The person's show came back exactly. */
  restored: boolean | null;
  stopped: boolean;
}

export interface FeatureStats {
  step: Phase;
  fpsAvg: number | null;
  droppedPct: number | null;
}

export interface Stats {
  seconds: number;
  target: number | null;
  fpsMin: number | null;
  fpsAvg: number | null;
  droppedPct: number | null;
  cpuMax: number | null;
  cpuAvg: number | null;
  appMemStart: number | null;
  appMemEnd: number | null;
  /** Lumora's own memory plus the control window's, growth over the test, MB. */
  memGrowthMb: number | null;
  recSpeedMin: number | null;
  recSpeedAvg: number | null;
  streamSpeedMin: number | null;
  diskMBps: number | null;
  baseline: FeatureStats;
  features: FeatureStats[];
  micPeaks: Record<string, number>;
}

const nums = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
export const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

/** Dropped frames as a share of the frames wanted, %, over these samples. */
export function droppedPct(samples: Sample[]): number | null {
  let dropped = 0;
  let wanted = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    if (b.dropped === null || b.target === null || a.dropped === null) continue;
    // Drawing started again (the count went back): what it counts now is all new.
    dropped += b.dropped >= a.dropped ? b.dropped - a.dropped : b.dropped;
    wanted += (b.target * (b.t - a.t)) / 1000;
  }
  return wanted > 0 ? (dropped / wanted) * 100 : null;
}

function featureStats(step: Phase, samples: Sample[]): FeatureStats {
  return { step, fpsAvg: round1(avg(nums(samples.map((s) => s.fps)))), droppedPct: round1(droppedPct(samples)) };
}

/** Heavier features, compared with the rest of the show. */
export const FEATURES: Phase[] = ['background', 'autoframe', 'captions', 'replay'];

export function analyze(m: Measured): Stats {
  const s = m.samples;
  // The first seconds of drawing are settling in; speeds start low.
  const settled = s.filter((x) => x.t >= (s[0]?.t ?? 0) + 5000);
  const mem = s.map((x) => (x.appMemMb === null && x.jsHeapMb === null ? null : (x.appMemMb ?? 0) + (x.jsHeapMb ?? 0)));
  const memVals = nums(mem);
  const appMem = nums(s.map((x) => x.appMemMb));
  const micPeaks: Record<string, number> = {};
  for (const x of s) for (const [id, v] of Object.entries(x.mics)) micPeaks[id] = Math.max(micPeaks[id] ?? 0, v);
  const show = s.filter((x) => x.step !== 'setup' && x.step !== 'finish');
  return {
    seconds: Math.round(m.ms / 1000),
    target: max(nums(s.map((x) => x.target))),
    fpsMin: min(nums(settled.map((x) => x.fps))),
    fpsAvg: round1(avg(nums(show.map((x) => x.fps)))),
    droppedPct: round1(droppedPct(show)),
    cpuMax: round1(max(nums(s.map((x) => x.cpu)))),
    cpuAvg: round1(avg(nums(s.map((x) => x.cpu)))),
    appMemStart: appMem[0] ?? null,
    appMemEnd: appMem.at(-1) ?? null,
    memGrowthMb: memVals.length >= 2 ? Math.round(avgTail(memVals) - avgHead(memVals)) : null,
    recSpeedMin: round1(min(nums(settled.map((x) => x.recSpeed)))),
    recSpeedAvg: round1(avg(nums(settled.map((x) => x.recSpeed)))),
    streamSpeedMin: round1(min(nums(settled.map((x) => x.streamSpeed)))),
    diskMBps: m.diskMBps === null ? null : Math.round(m.diskMBps),
    baseline: featureStats(
      'cuts',
      show.filter((x) => !FEATURES.includes(x.step)),
    ),
    features: FEATURES.map((f) =>
      featureStats(
        f,
        s.filter((x) => x.step === f),
      ),
    ).filter((f) => f.fpsAvg !== null),
    micPeaks,
  };
}

// Memory: the average of the first and last few readings (one reading jumps about).
const avgHead = (xs: number[]) => avg(xs.slice(0, Math.min(5, xs.length)))!;
const avgTail = (xs: number[]) => avg(xs.slice(-Math.min(5, xs.length)))!;

export type Severity = 'critical' | 'problem' | 'note';
export type Verdict = 'yes' | 'risky' | 'no';

export interface Finding {
  severity: Severity;
  /** Short, plain words for the owner. */
  title: string;
  detail: string;
  /** What to do about it. */
  advice: string;
  /** Likely cause and where in the code to look (for the developer). */
  where: string;
  /** What part of Lumora it is about. */
  area: string;
}

export const WHERE = {
  compositor: 'The picture is drawn too slowly: app/src/broadcast/compositor.ts (drawing) and app/src/broadcast/recorder.ts (frame pacing, frameStats).',
  encoder: 'FFmpeg cannot keep up: src-tauri/src/capture.rs (encoder settings, stream_args) and app/src/broadcast/recorder.ts (chunks sent).',
  recording: 'The recording file: src-tauri/src/capture.rs (writing and finishing the file) and app/src/broadcast/recorder.ts (MediaRecorder chunks).',
  disk: 'Disk writes: src-tauri/src/capture.rs (the writer thread and its queue, MAX_QUEUED).',
  hwEncoder: 'Encoders: src-tauri/src/encode.rs (choice, arguments, failure words) and capture.rs (the fallback).',
  memory:
    'Memory that keeps growing: app/src/broadcast/compositor.ts and app/src/broadcast/replay.ts (frames and blobs kept), src-tauri/src/perf.rs (measurement).',
  cpu: 'Processor load: app/src/broadcast/compositor.ts, app/src/engine/vision.ts, src-tauri/src/capture.rs (encoder preset).',
  outputs:
    'Output windows: app/src/views/OutputView.tsx (the page), src-tauri/src/outputs.rs (opening and placing), app/src/components/ScreenView.tsx (drawing Program).',
  multiview: 'The multiview: app/src/views/MultiviewView.tsx and src-tauri/src/outputs.rs (open_multiview).',
  stream: 'Streaming: src-tauri/src/capture.rs (open_stream, FFmpeg to RTMP) and app/src/broadcast/BroadcastContext.tsx (start, retries).',
  vertical: 'The vertical stream: app/src/broadcast/vertical.ts, app/src/broadcast/recorder.ts (startVertical), src-tauri/src/capture.rs.',
  preflight: 'Destination check: src-tauri/src/capture.rs (preflight, host_port) and crates/testevent/src/lib.rs (reach).',
  mic: 'Microphone sound: app/src/audio/soundEngine.ts (levels) and the device itself.',
  vision: 'Background removal and auto-framing: app/src/engine/vision.ts (InputVision, noteCost) and app/src/engine/chroma.ts.',
  captions: 'Live captions: app/src/captions/live.ts and app/src/captions/worker.ts.',
  replay: 'Instant replay: app/src/broadcast/replay.ts and makeReplay in app/src/broadcast/BroadcastContext.tsx.',
  restore: 'Putting the event back: src-tauri/src/testevent.rs (test_event_end, restore_at_start) and crates/testevent/src/lib.rs (the marker).',
  problems: 'The problem center: app/src/problems/problems.tsx; the reporter is named by the problem key.',
  console: 'Console errors: see the technical section for each line; app/src/reports/logs.ts keeps the app log.',
} as const;

const STEP_WHERE: Partial<Record<Phase, string>> = {
  cuts: 'Switching: crates/engine/src/screen.rs (take, cut) and app/src/components/ScreenView.tsx.',
  transitions: 'Transitions: crates/engine/src/screen.rs and app/src/components/ScreenView.tsx (useTransitionAnimation).',
  tbar: 'The T-bar: crates/engine/src/screen.rs (set_tbar).',
  names: 'Overlays: crates/engine/src/overlays.rs (auto-hide) and app/src/components/OverlaysView.tsx.',
  scoreboard: 'The scoreboard: crates/engine/src/score.rs and app/src/components/ScoreboardView.tsx.',
  countdown: 'The countdown: crates/engine/src/timing.rs (at zero → take Next) and app/src/components/CountdownOverlay.tsx.',
  slideshow: 'Slideshows: crates/engine/src/slideshow.rs and app/src/engine/slideshow.ts.',
  credits: 'Credits: crates/engine/src/credits.rs and app/src/components/CreditsView.tsx.',
  lyrics: 'Lyrics: crates/engine/src/lyrics.rs and app/src/components/LyricsView.tsx.',
  split: 'Split screen: crates/engine/src/split.rs and app/src/engine/split.ts.',
  visuals: 'Stage visuals: crates/engine/src/visuals.rs and app/src/visuals/.',
  pesukim: '12 Pesukim: crates/engine/src/pesukim.rs and app/src/components/PesukimView.tsx.',
  preset: 'Presets: crates/engine/src/presets.rs.',
  blank: 'Blank and fade to black: crates/engine/src/screen.rs (set_blank, fade_to_black).',
  backup:
    'The backup lineup: app/src/engine/backup.ts (Failover), app/src/engine/inputHealth.ts (what has a picture) and app/src/views/BackupLineup.tsx (BackupWatcher).',
  replay: WHERE.replay,
  background: WHERE.vision,
  autoframe: WHERE.vision,
  captions: WHERE.captions,
  outputs: WHERE.outputs,
  streamStart: WHERE.stream,
  streamStop: WHERE.stream,
  realDestination: WHERE.stream,
  panic: 'PANIC: crates/engine/src/engine.rs (panic) and app/src/components/ScreenView.tsx (data-panic layer).',
  setup: 'Setting up the test: app/src/testevent/runner.ts and src-tauri/src/testevent.rs.',
  finish: 'Finishing the test: app/src/testevent/runner.ts and src-tauri/src/testevent.rs.',
};

const FEATURE_NAMES: Partial<Record<Phase, string>> = {
  background: 'Background removal',
  autoframe: 'Auto-framing',
  captions: 'Live captions',
  replay: 'Instant replay',
  outputs: 'The output screens',
  backup: 'The backup lineup',
};

/** Steps the show can't do without: if one fails, a real event would go wrong. */
const CORE: Phase[] = ['cuts', 'transitions', 'panic', 'countdown', 'streamStart', 'setup'];

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, problem: 1, note: 2 };

export function sortFindings(fs: Finding[]): Finding[] {
  return [...fs].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function verdictOf(fs: Finding[]): Verdict {
  if (fs.some((f) => f.severity === 'critical')) return 'no';
  if (fs.some((f) => f.severity === 'problem')) return 'risky';
  return 'yes';
}

export const VERDICT_WORDS: Record<Verdict, { word: string; line: string }> = {
  yes: { word: 'YES', line: 'This computer can run an event like this.' },
  risky: { word: 'RISKY', line: 'This computer can run an event like this, but some things went wrong. Read the problems below first.' },
  no: { word: 'NO', line: 'Don’t run a real event like this on this computer until the critical problems below are fixed.' },
};

/** Judges the test: the problems (most serious first), the advice, the verdict. */
export function judge(m: Measured, st: Stats = analyze(m)): { verdict: Verdict; findings: Finding[]; advice: string[]; stats: Stats } {
  const f: Finding[] = [];
  const advice: string[] = [];
  const add = (severity: Severity, area: string, title: string, detail: string, adv: string, where: string) =>
    f.push({ severity, area, title, detail, advice: adv, where });
  const target = st.target ?? 30;

  // ----- the recording -----
  const rec = m.recording;
  if (!rec.file) {
    add(
      'critical',
      'Recording',
      'No recording was made',
      rec.error ?? 'The test recorded the whole time, but no file came out.',
      'Check the recording folder and that FFmpeg is installed.',
      WHERE.recording,
    );
  } else if (!rec.probe || !rec.probe.ok || rec.probe.frames === 0 || !rec.probe.video) {
    add(
      'critical',
      'Recording',
      'The recording file is broken',
      `FFmpeg could not read it all: ${rec.probe?.text.split('\n').at(-1) ?? rec.error ?? 'no answer'}`,
      'Don’t rely on the recording until this is fixed.',
      WHERE.recording,
    );
  } else {
    const secs = rec.probe.seconds ?? 0;
    if (rec.seconds > 10 && secs < rec.seconds * 0.8)
      add(
        'problem',
        'Recording',
        'The recording is shorter than the test',
        `It is ${Math.round(secs)} s long; the test recorded for ${Math.round(rec.seconds)} s.`,
        'Parts of the event may be missing from the recording.',
        WHERE.recording,
      );
    if (rec.probe.audioStreams === 0)
      add(
        'problem',
        'Recording',
        'The recording has no sound',
        'The file has a picture but no sound track.',
        'Check the sound settings (Settings → Recording and streaming → mix).',
        WHERE.recording,
      );
    else advice.push(`The recording is good: ${rec.probe.frames} frames, ${Math.round(secs)} s, with sound.`);
  }

  // ----- the picture -----
  if (st.fpsAvg !== null) {
    if (st.fpsAvg < target * 0.8)
      add(
        'critical',
        'Picture',
        'The picture was not smooth',
        `On average ${st.fpsAvg} frames a second were drawn; ${target} are needed.`,
        'Use fewer inputs at once, a lower picture quality (720p), or a stronger computer.',
        WHERE.compositor,
      );
    else if (st.fpsAvg < target * 0.95)
      add(
        'problem',
        'Picture',
        'The picture was sometimes not smooth',
        `On average ${st.fpsAvg} of ${target} frames a second.`,
        'Close other programs while you run the event.',
        WHERE.compositor,
      );
    if (st.fpsMin !== null && st.fpsMin < target * 0.5)
      add(
        'problem',
        'Picture',
        'The picture stalled at least once',
        `At its worst only ${st.fpsMin} frames a second were drawn.`,
        'Check the timeline in the details to see what was happening then.',
        WHERE.compositor,
      );
  }
  if (st.droppedPct !== null) {
    if (st.droppedPct > 5)
      add(
        'critical',
        'Picture',
        'Many frames were dropped',
        `${st.droppedPct}% of frames were dropped.`,
        'Viewers would see stutters. Lower the quality or use a stronger computer.',
        WHERE.compositor,
      );
    else if (st.droppedPct > 1)
      add(
        'problem',
        'Picture',
        'Some frames were dropped',
        `${st.droppedPct}% of frames were dropped.`,
        'Viewers may notice small stutters.',
        WHERE.compositor,
      );
  }
  for (const fe of st.features) {
    const name = FEATURE_NAMES[fe.step];
    if (!name) continue;
    const base = st.baseline;
    const dropWorse = fe.droppedPct !== null && fe.droppedPct > (base.droppedPct ?? 0) + 3;
    const fpsWorse = fe.fpsAvg !== null && fe.fpsAvg < target * 0.85 && (base.fpsAvg ?? target) >= target * 0.9;
    if (dropWorse || fpsWorse)
      add(
        'problem',
        name,
        `${name} dropped frames`,
        `While it ran: ${fe.fpsAvg ?? '?'} frames a second, ${fe.droppedPct ?? '?'}% dropped (the rest of the show: ${base.fpsAvg ?? '?'} fps, ${base.droppedPct ?? '?'}% dropped).`,
        fe.step === 'outputs' ? 'Use fewer output screens, or a stronger graphics card.' : `Don’t use ${name.toLowerCase()} on this computer.`,
        STEP_WHERE[fe.step] ?? WHERE.compositor,
      );
  }

  // ----- the encoder -----
  if (st.recSpeedAvg !== null && st.recSpeedAvg < 0.95)
    add(
      'critical',
      'Encoder',
      'The recording fell behind',
      `FFmpeg made the recording at ${st.recSpeedAvg}× real time on average (1× is needed).`,
      'Lower the picture quality or bitrate in Settings → Recording and streaming.',
      WHERE.encoder,
    );
  else if (st.recSpeedMin !== null && st.recSpeedMin < 0.9)
    add(
      'problem',
      'Encoder',
      'The recording fell behind for a moment',
      `At its slowest FFmpeg ran at ${st.recSpeedMin}× real time.`,
      'If it happens often, lower the picture quality.',
      WHERE.encoder,
    );
  if (st.streamSpeedMin !== null && st.streamSpeedMin < 0.9)
    add(
      'problem',
      'Encoder',
      'The stream fell behind for a moment',
      `At its slowest the stream was made at ${st.streamSpeedMin}× real time.`,
      'Lower the stream bitrate or quality.',
      WHERE.encoder,
    );

  // ----- the computer -----
  if (st.cpuMax !== null && st.cpuAvg !== null) {
    if (st.cpuAvg > 85)
      add(
        'problem',
        'Computer',
        'The processor was nearly full the whole time',
        `On average ${st.cpuAvg}% busy (at most ${st.cpuMax}%).`,
        'Close other programs; plug a laptop in to power; use fewer cameras.',
        WHERE.cpu,
      );
    else if (st.cpuMax > 97)
      add(
        'note',
        'Computer',
        'The processor was full for a moment',
        `At most ${st.cpuMax}% busy (on average ${st.cpuAvg}%).`,
        'Usually fine; watch for it in a longer test.',
        WHERE.cpu,
      );
  }
  if (st.memGrowthMb !== null) {
    const hours = Math.max(m.ms / 3_600_000, 1 / 60);
    const perHour = st.memGrowthMb / hours;
    if (m.ms >= 5 * 60_000 && perHour > 1000)
      add(
        'problem',
        'Memory',
        'Memory kept growing',
        `Lumora used ${st.memGrowthMb} MB more at the end (about ${Math.round(perHour)} MB an hour).`,
        'For a long event, restart Lumora before it starts and keep an eye on it.',
        WHERE.memory,
      );
    else if (st.memGrowthMb > 300)
      add(
        'note',
        'Memory',
        'Memory grew during the test',
        `Lumora used ${st.memGrowthMb} MB more at the end.`,
        'Run the Long test to see whether it keeps growing.',
        WHERE.memory,
      );
  }

  // ----- the encoders -----
  if (m.encoders?.failed.length)
    add(
      'problem',
      'Encoder',
      'The graphics card’s encoder stopped during the test',
      `${m.encoders.failed.join(', ')} failed; the processor took over.`,
      'Update the graphics driver, then run the test again. Until then, choose Software in Settings → Recording and streaming → Encoder.',
      WHERE.hwEncoder,
    );
  else if (m.encoders?.stream || m.encoders?.recording)
    advice.push(`Encoders used: recording — ${m.encoders.recording ?? 'not tested'}; stream — ${m.encoders.stream ?? 'not tested'}.`);

  // ----- the disk -----
  if (m.diskMBps !== null) {
    const where = m.userDrive ? 'your recording drive' : 'this computer’s drive';
    if (m.diskMBps < m.neededMBps * 1.5)
      add(
        'critical',
        'Disk',
        'The recording drive is too slow',
        `It writes ${Math.round(m.diskMBps)} MB/s; the recording needs ${round1(m.neededMBps)} MB/s.`,
        'Record to a faster drive (an internal SSD).',
        WHERE.disk,
      );
    else if (m.diskMBps < m.neededMBps * 4)
      add(
        'problem',
        'Disk',
        'The recording drive is only just fast enough',
        `It writes ${Math.round(m.diskMBps)} MB/s; the recording needs ${round1(m.neededMBps)} MB/s.`,
        'Camera files (ISO) and other programs could make it fall behind. Use a faster drive if you can.',
        WHERE.disk,
      );
    else advice.push(`Recording drive kept up (${Math.round(m.diskMBps)} MB/s on ${where}).`);
  }

  // ----- microphones -----
  for (const mic of m.mics) {
    const peak = st.micPeaks[mic.id] ?? 0;
    if (peak < 0.003)
      add(
        'problem',
        'Sound',
        `No sound came from “${mic.name}”`,
        'Its level stayed at zero for the whole test.',
        'Check it is plugged in, switched on and not muted (and that Lumora may use the microphone).',
        WHERE.mic,
      );
  }

  // ----- output screens -----
  if (m.outputsTested) {
    if (m.extraDisplays === 0)
      add(
        'note',
        'Output screens',
        'No extra screens connected — outputs tested as windows on the main screen',
        'Each output opened as a small window; the checks are the same.',
        'Run the test again with your projectors connected before the event.',
        WHERE.outputs,
      );
    for (const o of m.outputs) {
      const name = OUTPUT_NAMES[o.output];
      const where = o.output === 'multiview' ? WHERE.multiview : WHERE.outputs;
      if (!o.opened) {
        add(
          'critical',
          'Output screens',
          `${name} did not open`,
          o.error ?? 'Its window never came up.',
          'Open it from Settings → Outputs and try again.',
          where,
        );
        continue;
      }
      if (o.fps === null)
        add('problem', 'Output screens', `${name} did not answer`, o.error ?? 'It did not report how it was drawing.', 'Close it and open it again.', where);
      else if (o.fps < 20)
        add(
          'problem',
          'Output screens',
          `${name} was not smooth`,
          `It drew ${o.fps} frames a second.`,
          'Use fewer output screens or a stronger graphics card.',
          where,
        );
      if (o.inSync === false)
        add(
          'problem',
          'Output screens',
          `${name} was out of step with Program`,
          'It did not show what was on air.',
          'Close it and open it again; report this to the Lumora team.',
          where,
        );
      if (o.black === true)
        add('problem', 'Output screens', `${name} stayed black`, 'Its picture was black while something was on air.', 'Close it and open it again.', where);
      if (o.overlays === false)
        add(
          'problem',
          'Output screens',
          `${name} did not show the name title`,
          'An overlay was on air but did not show there.',
          'Report this to the Lumora team.',
          where,
        );
      if (o.tally === false)
        add('note', 'Output screens', `${name} showed no tally`, 'The red and green on-air marks were not found.', 'Check the multiview layout.', where);
    }
    if (m.fullscreenOk === false)
      add(
        'problem',
        'Output screens',
        'Full screen did not work',
        'An output could not be put full screen on the main display.',
        'Use F11 on an output window, or assign it a display in Settings → Outputs.',
        WHERE.outputs,
      );
    if (m.outputs.length && m.outputs.every((o) => o.opened && o.fps !== null && o.fps >= 20 && o.inSync !== false && o.black !== true))
      advice.push(`All ${m.outputs.length} output screens drew the show smoothly and in step.`);
  }

  // ----- streams -----
  if (m.streamTested) {
    for (const s of m.streams) {
      const where = s.vertical ? WHERE.vertical : WHERE.stream;
      const what = `${s.vertical ? 'The vertical stream' : 'The stream'}${s.local ? '' : ` to ${s.name}`}`;
      if (!s.started) {
        add(
          s.vertical || !s.local ? 'problem' : 'critical',
          'Streaming',
          `${what} did not start`,
          s.error ?? 'It never started.',
          'Check Settings → Recording and streaming.',
          where,
        );
        continue;
      }
      if (s.local && (!s.probe || !s.probe.ok || s.probe.frames === 0))
        add(
          'critical',
          'Streaming',
          `${what} did not arrive`,
          `The test receiver got ${s.probe?.frames ?? 0} frames. ${s.error ?? ''}`.trim(),
          'Viewers would see nothing. Report this to the Lumora team.',
          where,
        );
      else if (s.local && s.probe && s.probe.audioStreams === 0)
        add('problem', 'Streaming', `${what} arrived without sound`, 'The receiver got pictures but no sound.', 'Check the Stream mix in the mixer.', where);
      if (s.reconnects > 0)
        add(
          'problem',
          'Streaming',
          `${what} dropped and came back`,
          `It reconnected ${s.reconnects} time(s).`,
          'On a real event that is a gap viewers see.',
          where,
        );
      if (s.started && s.local && s.probe && s.probe.frames > 0 && s.reconnects === 0)
        advice.push(`${what} went all the way through (${s.probe.frames} frames received${s.avgKbps ? `, about ${Math.round(s.avgKbps)} kbit/s` : ''}).`);
    }
  }
  for (const r of m.preflight) {
    if (!r.reachable)
      add('problem', 'Streaming', `${r.name} could not be reached`, r.message, 'Check the internet connection and the server address.', WHERE.preflight);
    else if (!r.hasKey)
      add('problem', 'Streaming', `${r.name} has no stream key`, r.message, 'Paste the stream key in Settings → Recording and streaming.', WHERE.preflight);
  }

  // ----- the steps -----
  for (const s of m.steps) {
    if (s.ok || s.skipped) continue;
    add(
      CORE.includes(s.kind) ? 'critical' : 'problem',
      'Show',
      `“${s.label}” went wrong`,
      s.error ?? 'It failed.',
      'Avoid this part in a real event until it is fixed, and send the report to the Lumora team.',
      STEP_WHERE[s.kind] ?? WHERE.problems,
    );
  }

  // ----- what the app itself noticed -----
  for (const p of m.problems)
    add(
      p.level === 'error' ? 'problem' : 'note',
      'Problem center',
      p.title,
      p.detail ?? '',
      'See the problem center (the light on the bottom bar) for what to do.',
      WHERE.problems,
    );
  for (const c of m.captureFailures) add('problem', 'Recording', 'Recording or streaming stopped by itself', c, 'Check the details below.', WHERE.encoder);
  const errors = m.console.filter((l) => /\bERROR\b|Unhandled|Uncaught/.test(l)).length;
  if (errors > 20)
    add('problem', 'App', `${errors} errors were logged`, 'Lumora logged many errors during the test.', 'Send the report to the Lumora team.', WHERE.console);
  else if (errors > 0)
    add(
      'note',
      'App',
      `${errors} error(s) were logged`,
      'Lumora logged some errors during the test (listed in the details).',
      'Usually harmless; the Lumora team can check them.',
      WHERE.console,
    );

  if (m.restored === false)
    add(
      'critical',
      'Safety',
      'Your event was not put back by itself',
      'The test could not restore your show. It is kept safely and comes back the next time Lumora starts.',
      'Close Lumora and open it again.',
      WHERE.restore,
    );
  if (m.stopped)
    add(
      'note',
      'Test',
      'The test was stopped before the end',
      'Only the parts that ran are judged.',
      'Run the whole test before a real event.',
      STEP_WHERE.finish!,
    );

  if (st.cpuMax !== null && st.cpuMax <= 80) advice.push(`The processor had room to spare (at most ${st.cpuMax}% busy).`);
  const findings = sortFindings(f);
  return { verdict: verdictOf(findings), findings, advice, stats: st };
}

export const OUTPUT_NAMES: Record<OutputName, string> = {
  live: 'The Live Screen output',
  back: 'The Back Screen output',
  monitor: 'The stage Monitor',
  multiview: 'The multiview',
};
