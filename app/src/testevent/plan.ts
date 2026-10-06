// The test event's plan (Settings → Run a test event…): which inputs it adds
// for what this computer has, and the show it runs with them. Pure: the
// runner (./runner.ts) does the work, this only decides.

import type { TransitionKind } from '../engine/types/TransitionKind';

export type TestLength = 'quick' | 'standard' | 'long';

export const LENGTHS: Record<TestLength, { name: string; minutes: number; hint: string }> = {
  quick: { name: 'Quick', minutes: 2, hint: 'Everything once' },
  standard: { name: 'Standard', minutes: 10, hint: 'A short event' },
  long: { name: 'Long', minutes: 30, hint: 'Catches heat and memory problems' },
};

export interface TestOptions {
  length: TestLength;
  /** Use the cameras and microphones connected to this computer. */
  devices: boolean;
  /** Open the output windows (on their own screens, or as small windows). */
  outputs: boolean;
  /** Stream for real to a receiver on this computer (nothing leaves it). */
  stream: boolean;
  /** Record to the drive the person records to (else the temporary folder). */
  userDrive: boolean;
  /** Also a short test to one of the person's own destinations (confirmed). */
  realDestination: string | null;
}

export function defaultOptions(env?: Pick<TestEnv, 'cameras' | 'mics'>): TestOptions {
  return {
    length: 'quick',
    devices: !!env && env.cameras.length + env.mics.length > 0,
    outputs: true,
    stream: true,
    userDrive: true,
    realDestination: null,
  };
}

export interface Device {
  deviceId: string;
  label: string;
}

/** What this computer and event have, found before the test starts. */
export interface TestEnv {
  cameras: Device[];
  mics: Device[];
  /** FFmpeg was found (test media, the recording check, the stream test). */
  ffmpeg: boolean;
  jewishTools: boolean;
  /** Stinger transitions set up on this computer (1 or 2 of them). */
  stingers: number;
  /** Live captions have been used here (the speech model is on this computer). */
  captionsReady: boolean;
  /** The person streams a vertical version too. */
  vertical: boolean;
}

export type InputKind =
  | 'camera'
  | 'microphone'
  | 'pattern'
  | 'color'
  | 'video'
  | 'image'
  | 'name'
  | 'title'
  | 'scoreboard'
  | 'countdown'
  | 'visuals'
  | 'slideshow'
  | 'credits'
  | 'split'
  | 'lyrics'
  | 'pesukim';

export interface PlannedInput {
  /** The id it gets in the test show. */
  id: string;
  kind: InputKind;
  name: string;
  deviceId?: string;
}

export interface Skipped {
  what: string;
  why: string;
}

/** At most this many cameras and microphones are used (more adds little). */
export const MAX_DEVICES = 4;

/** The inputs to add: every kind that runs without the internet or the person's own files. */
export function planInputs(opts: TestOptions, env: TestEnv): { inputs: PlannedInput[]; skipped: Skipped[] } {
  const inputs: PlannedInput[] = [];
  const skipped: Skipped[] = [];
  if (!opts.devices) {
    if (env.cameras.length + env.mics.length) skipped.push({ what: 'Cameras and microphones', why: 'You chose not to use them.' });
  } else {
    if (!env.cameras.length) skipped.push({ what: 'Cameras', why: 'No camera was found on this computer.' });
    if (!env.mics.length) skipped.push({ what: 'Microphones', why: 'No microphone was found on this computer.' });
    env.cameras
      .slice(0, MAX_DEVICES)
      .forEach((c, i) => inputs.push({ id: `test-camera-${i + 1}`, kind: 'camera', name: c.label || `Camera ${i + 1}`, deviceId: c.deviceId }));
    env.mics
      .slice(0, MAX_DEVICES)
      .forEach((m, i) => inputs.push({ id: `test-mic-${i + 1}`, kind: 'microphone', name: m.label || `Microphone ${i + 1}`, deviceId: m.deviceId }));
    if (env.cameras.length > MAX_DEVICES)
      skipped.push({ what: `${env.cameras.length - MAX_DEVICES} more cameras`, why: `The test uses the first ${MAX_DEVICES}.` });
  }
  const add = (kind: InputKind, name: string) => inputs.push({ id: `test-${kind}`, kind, name });
  add('pattern', 'Test pattern');
  add('color', 'Color');
  if (env.ffmpeg) {
    add('video', 'Test video');
    add('image', 'Test picture');
    add('slideshow', 'Test slides');
  } else {
    skipped.push({ what: 'Video, picture and slideshow', why: 'FFmpeg was not found, so the test media could not be made.' });
  }
  add('name', 'Name title');
  add('title', 'Big title');
  add('scoreboard', 'Scoreboard');
  add('countdown', 'Countdown');
  add('visuals', 'Stage visuals');
  add('credits', 'Credits');
  add('split', 'Split screen');
  add('lyrics', 'Song lyrics');
  if (env.jewishTools) add('pesukim', '12 Pesukim');
  return { inputs, skipped };
}

/** The inputs that make a picture (for cuts and transitions). */
export function pictureInputs(inputs: PlannedInput[]): PlannedInput[] {
  const order: InputKind[] = ['camera', 'video', 'pattern', 'image', 'color', 'split', 'title'];
  return order.flatMap((k) => inputs.filter((i) => i.kind === k));
}

export const BASE_TRANSITIONS: TransitionKind[] = [
  'cut',
  'fade',
  'merge',
  'dip',
  'wipe',
  'slide',
  'wipeLeft',
  'wipeDown',
  'wipeUp',
  'slideRight',
  'slideDown',
  'slideUp',
  'cover',
  'reveal',
  'split',
  'splitVertical',
  'iris',
  'diamond',
  'zoom',
  'zoomOut',
  'blur',
  'flash',
  'lumaClock',
  'lumaCircle',
  'lumaBlinds',
  'lumaDiagonal',
  'lumaSparkle',
  'lumaHeart',
];

/** Every transition, with the stingers this computer has set up. */
export function transitions(env: Pick<TestEnv, 'stingers'>): TransitionKind[] {
  const stingers: TransitionKind[] = (['stinger1', 'stinger2'] as const).slice(0, Math.max(0, Math.min(2, env.stingers)));
  return [...BASE_TRANSITIONS, ...stingers];
}

export type StepKind =
  | 'outputs'
  | 'streamStart'
  | 'cuts'
  | 'transitions'
  | 'tbar'
  | 'names'
  | 'scoreboard'
  | 'countdown'
  | 'slideshow'
  | 'credits'
  | 'lyrics'
  | 'split'
  | 'visuals'
  | 'pesukim'
  | 'preset'
  | 'blank'
  | 'backup'
  | 'replay'
  | 'background'
  | 'autoframe'
  | 'captions'
  | 'realDestination'
  | 'streamStop'
  | 'panic';

export interface PlannedStep {
  kind: StepKind;
  label: string;
  /** About how long it takes, seconds. */
  seconds: number;
  /** Which round of the show (0: the first). */
  round: number;
}

const LABELS: Record<StepKind, string> = {
  outputs: 'Output screens',
  streamStart: 'Start the stream (to this computer)',
  cuts: 'Cuts between inputs',
  transitions: 'Every transition',
  tbar: 'T-bar',
  names: 'Name titles on and off',
  scoreboard: 'Scoreboard and game clock',
  countdown: 'Countdown to zero',
  slideshow: 'Slideshow',
  credits: 'Credits',
  lyrics: 'Song lyrics',
  split: 'Split screen',
  visuals: 'Stage visuals',
  pesukim: '12 Pesukim',
  preset: 'Presets',
  blank: 'Blank and fade to black',
  backup: 'Backup lineup (a camera lost)',
  replay: 'Instant replay',
  background: 'Background removal',
  autoframe: 'Auto-framing',
  captions: 'Live captions',
  realDestination: 'Short test to your own destination',
  streamStop: 'Stop the stream',
  panic: 'PANIC and recovery',
};

export const stepLabel = (k: StepKind) => LABELS[k];

/** One round of the show: everything once. */
export function showRound(opts: TestOptions, env: TestEnv, inputs: PlannedInput[], round: number): PlannedStep[] {
  const has = (k: InputKind) => inputs.some((i) => i.kind === k);
  const camera = has('camera');
  const kinds: [StepKind, number, boolean][] = [
    ['cuts', 10, true],
    ['transitions', Math.ceil(transitions(env).length * 1.1), true],
    ['tbar', 4, true],
    ['names', 8, true],
    ['scoreboard', 6, true],
    ['countdown', 8, true],
    ['slideshow', 7, has('slideshow')],
    ['credits', 6, true],
    ['lyrics', 5, true],
    ['split', 4, true],
    ['visuals', 4, true],
    ['pesukim', 4, has('pesukim')],
    ['preset', 4, true],
    ['blank', 6, true],
    ['backup', 12, pictureInputs(inputs).length >= 2],
    ['replay', 8, true],
    ['background', 12, camera],
    ['autoframe', 10, camera],
    ['captions', 8, env.captionsReady && (has('microphone') || camera)],
  ];
  return kinds.filter(([, , on]) => on).map(([kind, seconds]) => ({ kind, label: LABELS[kind], seconds, round }));
}

const total = (steps: PlannedStep[]) => steps.reduce((t, s) => t + s.seconds, 0);

/**
 * The whole show: outputs and the stream first, then rounds of the show until
 * the chosen length is used (always at least one round), then PANIC.
 */
export function planShow(opts: TestOptions, env: TestEnv, inputs: PlannedInput[]): PlannedStep[] {
  const target = LENGTHS[opts.length].minutes * 60;
  const steps: PlannedStep[] = [];
  const start = (kind: StepKind, seconds: number) => steps.push({ kind, label: LABELS[kind], seconds, round: 0 });
  if (opts.outputs) start('outputs', 12);
  const streaming = opts.stream && env.ffmpeg;
  if (streaming) start('streamStart', 4);
  const end: PlannedStep[] = [];
  if (streaming && opts.realDestination) end.push({ kind: 'realDestination', label: LABELS.realDestination, seconds: 40, round: 0 });
  if (streaming) end.push({ kind: 'streamStop', label: LABELS.streamStop, seconds: 12, round: 0 });
  end.push({ kind: 'panic', label: LABELS.panic, seconds: 6, round: 0 });
  let round = 0;
  do {
    steps.push(...showRound(opts, env, inputs, round));
    round++;
  } while (total(steps) + total(end) + total(showRound(opts, env, inputs, round)) <= target && round < 200);
  // Fill what is left with cuts (a quiet stretch of the event).
  const left = target - total(steps) - total(end);
  if (left >= 10) steps.push({ kind: 'cuts', label: LABELS.cuts, seconds: left, round });
  return [...steps, ...end];
}

export const plannedSeconds = total;
