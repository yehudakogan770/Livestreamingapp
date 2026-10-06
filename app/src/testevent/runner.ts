// The test event itself: puts the person's show aside, builds a test show
// with every kind of input, runs a realistic show with it while recording and
// streaming to this computer, measures everything, checks the files, puts the
// person's show back and cleans up. The plan is in ./plan.ts; the judgment in
// ./verdict.ts; the report in ./report.ts.

import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { CaptureSettings, CaptureStatus, EngineClient, PerfStats } from '../engine/client';
import { defaultCountdown } from '../engine/client';
import { defaultAutoFrame, defaultBackground } from '../engine/chroma';
import { defaultCredits, parseNames } from '../engine/credits';
import { defaultLyrics } from '../engine/lyrics';
import { defaultPesukim } from '../engine/pesukim';
import { defaultScoreboard } from '../engine/score';
import { defaultSlideshow } from '../engine/slideshow';
import { defaultSplit } from '../engine/split';
import { TEXT_TEMPLATES } from '../engine/text';
import { defaultBackup, MANUAL_GRACE_MS } from '../engine/backup';
import { backupLog as defaultBackupLog, type BackupLog } from '../engine/backupLog';
import { inputHealth, type InputHealth } from '../engine/inputHealth';
import type { Action } from '../engine/types/Action';
import type { NewSource } from '../engine/types/NewSource';
import type { Show } from '../engine/types/Show';
import type { TransitionKind } from '../engine/types/TransitionKind';
import type { Problem } from '../problems/problems';
import { scrub } from '../reports/scrub';
import { PROBE_EVENT, PROBE_RESULT, type ProbeAnswer } from './outputProbe';
import { pictureInputs, planInputs, planShow, transitions, type PlannedInput, type PlannedStep, type TestEnv, type TestOptions } from './plan';
import { withTestSession, type SessionApi } from './session';
import type { Measured, OutputCheck, OutputName, Phase, Probe, Reach, Sample, StepRecord, StreamCheck } from './verdict';

/** What the runner needs from the control window (always the latest). */
export interface BroadcastApi {
  status: CaptureStatus;
  settings: CaptureSettings;
  saveSettings(s: CaptureSettings): Promise<void>;
  start(kind: 'record' | 'stream'): Promise<void>;
  stop(kind: 'record' | 'stream'): Promise<void>;
  rehearsal: boolean;
  setRehearsal(on: boolean): void;
  replayOn: boolean;
  setReplay(on: boolean): void;
  frameStats(): { fps: number; target: number; dropped: number } | null;
  makeReplay(seconds: number, speed: number): Promise<string>;
}

export interface RunnerDeps {
  client: EngineClient;
  broadcast: () => BroadcastApi | null;
  show: () => Show | null;
  levels: () => Map<string, number> | null;
  problems: () => Problem[];
  onProgress: (p: Progress) => void;
  signal: AbortSignal;
  /** Tauri commands (a test can replace it). */
  call?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  /** What has a picture, and what the backup lineup did (a test can replace them). */
  health?: InputHealth;
  backupLog?: BackupLog;
}

export interface Progress {
  /** 0 – 1. */
  done: number;
  elapsedMs: number;
  plannedMs: number;
  current: string;
  steps: StepRecord[];
  sample: Sample | null;
}

export interface RunResult {
  measured: Measured;
  inputs: PlannedInput[];
  skipped: { what: string; why: string }[];
  settings: CaptureSettings | null;
  error: string | null;
}

class Stopped extends Error {
  constructor() {
    super('Stopped');
    this.name = 'Stopped';
  }
}

interface Media {
  video: string | null;
  videoSeconds: number;
  image: string | null;
  slides: string[];
  errors: string[];
}

interface ReceiverInfo {
  port: number;
  file: string;
  vertical: boolean;
}

const TEST_SHOW_NAME = 'Lumora test event';

/** The person's cameras and microphones (asking once so their names can be read). */
export async function findDevices(): Promise<Pick<TestEnv, 'cameras' | 'mics'>> {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md?.enumerateDevices) return { cameras: [], mics: [] };
  let list = await md.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
  if (list.some((d) => !d.label && d.kind !== 'audiooutput')) {
    try {
      const s = await md.getUserMedia({ video: list.some((d) => d.kind === 'videoinput'), audio: list.some((d) => d.kind === 'audioinput') });
      s.getTracks().forEach((t) => t.stop());
      list = await md.enumerateDevices();
    } catch {
      // No permission: the devices are still used, with plain names.
    }
  }
  const real = (d: MediaDeviceInfo) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications';
  return {
    cameras: list.filter((d) => d.kind === 'videoinput' && real(d)).map((d) => ({ deviceId: d.deviceId, label: d.label })),
    mics: list.filter((d) => d.kind === 'audioinput' && real(d)).map((d) => ({ deviceId: d.deviceId, label: d.label })),
  };
}

/** Why the test can't start now (null: it can). */
export function cannotStart(status: CaptureStatus | null | undefined): string | null {
  if (status?.recording) return 'Lumora is recording. Stop the recording first; the test event can’t run during a real one.';
  if (status?.streaming || status?.vertical) return 'Lumora is streaming. The test event can’t run while you are live.';
  return null;
}

/** MB/s a recording with these settings writes (the main file, plus a file per camera). */
export function neededMBps(s: Pick<CaptureSettings, 'videoKbps' | 'audioKbps' | 'iso' | 'isoKbps'>, cameras: number): number {
  const main = (s.videoKbps + s.audioKbps) / 8 / 1000;
  const camera = s.isoKbps ? s.isoKbps / 8 / 1000 : main * 0.8;
  return main + (s.iso ? cameras * camera : 0);
}

export async function runTestEvent(opts: TestOptions, env: TestEnv, deps: RunnerDeps): Promise<RunResult> {
  const call = deps.call ?? (<T>(cmd: string, args?: Record<string, unknown>) => invoke<T>(cmd, args));
  const { client, signal } = deps;
  const health = deps.health ?? inputHealth;
  const backupLog = deps.backupLog ?? defaultBackupLog;
  const why = cannotStart(deps.broadcast()?.status);
  if (why) throw new Error(why);
  const t0 = Date.now();
  const at = () => Date.now() - t0;
  const { inputs, skipped } = planInputs(opts, env);
  const plan = planShow(opts, env, inputs);
  const plannedMs = (plan.reduce((t, s) => t + s.seconds, 0) + 40) * 1000;

  const steps: StepRecord[] = [];
  const samples: Sample[] = [];
  const consoleLines: string[] = [];
  const seenProblems = new Map<string, Measured['problems'][number]>();
  const captureFailures: string[] = [];
  const outputs: OutputCheck[] = [];
  const streams: StreamCheck[] = [];
  let preflight: Reach[] = [];
  let diskMBps: number | null = null;
  let extraDisplays = 0;
  let fullscreenOk: boolean | null = null;
  let phase: Phase = 'setup';
  let current = 'Getting ready';
  let ownSettings: CaptureSettings | null = null;
  const recording: Measured['recording'] = { file: null, probe: null, seconds: 0 };
  let recStartedAt = 0;
  // Which encoders did the work (the report says, since a graphics card can't be checked from here).
  const encoders: NonNullable<Measured['encoders']> = { recording: null, stream: null, vertical: null, hardware: [], failed: [] };
  const noteEncoders = () => {
    const st = deps.broadcast()?.status;
    if (!st) return;
    encoders.recording = st.recording?.encoder ?? encoders.recording;
    encoders.stream = st.streaming?.encoder ?? encoders.stream;
    encoders.vertical = st.vertical?.encoder ?? encoders.vertical;
    encoders.hardware = st.hwEncoders ?? encoders.hardware;
    encoders.failed = st.hwFailed ?? encoders.failed;
  };
  const problemsBefore = new Set(deps.problems().map((p) => p.key));

  const progress = () =>
    deps.onProgress({ done: Math.min(0.99, at() / plannedMs), elapsedMs: at(), plannedMs, current, steps: [...steps], sample: samples.at(-1) ?? null });

  const sleep = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Stopped());
      const id = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(id);
        reject(new Stopped());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  const act = (a: Action) => client.dispatch(a);
  const show = () => {
    const s = deps.show();
    if (!s) throw new Error('The show is not loaded');
    return s;
  };
  const bc = () => {
    const b = deps.broadcast();
    if (!b) throw new Error('Recording is not available here');
    return b;
  };
  const waitFor = async (what: string, ok: () => boolean, ms: number) => {
    const end = Date.now() + ms;
    while (!ok()) {
      if (Date.now() > end) throw new Error(`Timed out: ${what}`);
      await sleep(150);
    }
  };

  // ----- console errors and warnings during the run -----
  const original = { error: console.error, warn: console.warn };
  const keep = (level: string, args: unknown[]) => {
    if (consoleLines.length < 400)
      consoleLines.push(
        `${new Date().toISOString().slice(11, 23)} ${level} ${scrub(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : safe(a))).join(' '), 400)}`,
      );
  };
  console.error = (...a: unknown[]) => {
    keep('ERROR', a);
    original.error.apply(console, a);
  };
  console.warn = (...a: unknown[]) => {
    keep('WARN ', a);
    original.warn.apply(console, a);
  };
  const onError = (e: ErrorEvent) => keep('ERROR', [`Uncaught ${e.message}${e.error instanceof Error && e.error.stack ? `\n${e.error.stack}` : ''}`]);
  const onRejection = (e: PromiseRejectionEvent) =>
    keep('ERROR', [`Unhandled rejection: ${e.reason instanceof Error ? `${e.reason.message}\n${e.reason.stack ?? ''}` : safe(e.reason)}`]);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  // ----- measuring, about once a second -----
  let sampling = true;
  let firstSession = Number.MAX_SAFE_INTEGER;
  const sampleLoop = (async () => {
    while (sampling) {
      try {
        const b = deps.broadcast();
        const fs = b?.frameStats() ?? null;
        const perf = await client.perfStats().catch((): PerfStats | null => null);
        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        const levels = deps.levels();
        const mics: Record<string, number> = {};
        for (const i of inputs) if (i.kind === 'microphone') mics[i.id] = levels?.get(i.id) ?? 0;
        const st = b?.status;
        samples.push({
          t: at(),
          step: phase,
          fps: fs?.fps ?? null,
          target: fs?.target ?? null,
          dropped: fs?.dropped ?? null,
          recSpeed: st?.recording?.speed ?? null,
          streamSpeed: st?.streaming?.speed ?? null,
          recBytes: st?.recording?.bytes ?? null,
          streamBytes: st?.streaming?.bytes ?? null,
          cpu: perf?.cpu ?? null,
          memUsedMb: perf?.memUsedMb ?? null,
          appMemMb: perf?.appMemMb ?? null,
          jsHeapMb: mem ? Math.round(mem.usedJSHeapSize / 1e6) : null,
          mics,
        });
        for (const p of deps.problems())
          if (!problemsBefore.has(p.key) && !seenProblems.has(p.key)) seenProblems.set(p.key, { level: p.level, title: p.title, detail: p.detail, at: at() });
        for (const f of st?.failures ?? (st?.failure ? [st.failure] : [])) {
          const line = `${f.kind} (session ${f.session}): ${f.message}`;
          if (f.session >= firstSession && !captureFailures.includes(line)) captureFailures.push(line);
        }
        progress();
      } catch {
        // Measuring must never stop the test.
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();

  /** Runs one step and records it. */
  const step = async (kind: Phase, label: string, round: number, run: (note: (s: string) => void) => Promise<void>, always = false) => {
    const rec: StepRecord = { kind, label, round, at: at(), ms: 0, ok: false, notes: [] };
    steps.push(rec);
    phase = kind;
    current = label;
    progress();
    try {
      if (signal.aborted && !always) throw new Stopped();
      await run((s) => rec.notes.push(s));
      rec.ok = true;
    } catch (e) {
      if (e instanceof Stopped) {
        rec.skipped = true;
        rec.notes.push('stopped');
        throw e;
      }
      rec.error = e instanceof Error ? e.message : String(e);
      rec.stack = e instanceof Error ? e.stack : undefined;
    } finally {
      rec.ms = at() - rec.at;
    }
  };

  const api: SessionApi = {
    begin: (userDrive) => call<{ folder: string }>('test_event_begin', { userDrive }),
    end: () => call<boolean>('test_event_end'),
    cleanup: async (folder, replays) => {
      await call('test_event_cleanup', { folder, replays });
    },
  };

  let error: string | null = null;
  let stopped = false;
  ownSettings = deps.broadcast()?.settings ?? null;

  const session = await withTestSession(
    api,
    opts.userDrive,
    async ({ folder, undo, replays }) => {
      const rec0 = bc();
      // The provider's own copy of the settings follows the test's (and comes back after).
      undo.add('reload the recording settings', async () => {
        const s = await client.captureSettings();
        await deps.broadcast()?.saveSettings(s);
      });
      await bc().saveSettings(await client.captureSettings());
      if (rec0.rehearsal) rec0.setRehearsal(false);

      // ----- setting up -----
      await step('setup', 'Switch to the test show', 0, async (note) => {
        await waitFor('the test show', () => deps.show()?.event.name === TEST_SHOW_NAME, 10_000);
        note('your event is put aside safely');
      });
      let media: Media | null = null;
      if (env.ffmpeg)
        await step('setup', 'Make the test video, picture and slides', 0, async (note) => {
          media = await call<Media>('test_event_media', { folder });
          note(`video: ${media.video ? 'made' : 'not made'}, slides: ${media.slides.length}`);
          if (media.errors.length && !media.video) throw new Error(`FFmpeg could not make the test media: ${media.errors.join(' | ')}`);
        });
      await step('setup', 'Measure the recording drive', 0, async (note) => {
        diskMBps = await call<number>('test_event_disk_speed', { folder });
        note(`${Math.round(diskMBps)} MB/s`);
      });
      await step('setup', `Add ${inputs.length} inputs`, 0, async (note) => {
        for (const i of inputs) {
          const src = newSource(i, media, inputs);
          if (!src) {
            note(`${i.name}: left out (no test media)`);
            continue;
          }
          await act({ type: 'addSource', source: src });
        }
        await waitFor('the inputs', () => inputs.every((i) => show().sources.some((s) => s.id === i.id) || !newSource(i, media, inputs)), 10_000);
        note(inputs.map((i) => i.kind).join(', '));
      });
      const pics = pictureInputs(inputs).filter((i) => show().sources.some((s) => s.id === i.id));
      if (pics.length < 2) throw new Error('Not enough picture inputs to run a show');
      let next = 0;
      const nextPic = (not?: string | null) => {
        for (let k = 0; k < pics.length; k++) {
          const p = pics[(next + k) % pics.length]!;
          if (p.id !== not) {
            next = (next + k + 1) % pics.length;
            return p.id;
          }
        }
        return pics[0]!.id;
      };
      await step('setup', 'Set up the name title, a preset and instant replay', 0, async () => {
        await act({ type: 'setOverlaySource', channel: 0, sourceId: 'test-name' });
        await act({ type: 'updateOverlay', channel: 0, patch: { autoHideMs: 4000, screens: ['live', 'back'] } });
        await act({
          type: 'addPreset',
          preset: {
            id: 'test-preset',
            name: 'Test segment',
            category: 'Test',
            screen: 'live',
            sources: pics.slice(0, 3).map((p) => p.id),
            transition: { kind: 'fade', durationMs: 500 },
            loadFirst: true,
            buttons: [],
          },
        });
        await act({ type: 'cutTo', screen: 'live', sourceId: pics[0]!.id });
        await act({ type: 'setPreview', screen: 'live', sourceId: pics[1]!.id });
        bc().setReplay(true);
        undo.add('turn instant replay off', () => deps.broadcast()?.setReplay(false));
      });
      await step('setup', 'Start recording', 0, async (note) => {
        const before = bc().status.recording?.session ?? 0;
        undo.add('stop the recording', async () => {
          if (deps.broadcast()?.status.recording) await deps.broadcast()?.stop('record');
        });
        await bc().start('record');
        await waitFor('the recording to start', () => !!deps.broadcast()?.status.recording, 20_000);
        firstSession = Math.min(firstSession, bc().status.recording!.session);
        recStartedAt = Date.now();
        noteEncoders();
        note(`session ${bc().status.recording!.session} (was ${before})`);
      });

      // ----- the show -----
      const streamRun: { check: StreamCheck | null; vertical: StreamCheck | null; receivers: ReceiverInfo[]; startedAt: number; startBytes: number } = {
        check: null,
        vertical: null,
        receivers: [],
        startedAt: 0,
        startBytes: 0,
      };
      const openedOutputs: string[] = [];
      undo.add('close the output windows', async () => {
        for (const o of openedOutputs) {
          if (o === 'multiview') await client.closeMultiview().catch(() => {});
          else await client.closeOutput(o as 'live').catch(() => {});
        }
      });

      const takeWith = async (kind: TransitionKind, ms: number) => {
        const target = nextPic(show().screens.live.program);
        await act({ type: 'setPreview', screen: 'live', sourceId: target });
        await act({ type: 'take', screen: 'live', transition: kind, durationMs: ms });
        return target;
      };
      const stingerMs = (k: TransitionKind) => {
        const st = show().settings.stingers;
        const s = k === 'stinger1' ? st[0] : k === 'stinger2' ? st[1] : undefined;
        return s ? s.durationMs : 0;
      };

      const run = async (s: PlannedStep) => {
        await step(s.kind, s.label, s.round, async (note) => {
          switch (s.kind) {
            case 'outputs':
              await testOutputs(note);
              break;
            case 'streamStart':
              await startStream(note);
              break;
            case 'streamStop':
              await stopStream(note);
              break;
            case 'realDestination':
              await realDestination(note);
              break;
            case 'cuts': {
              const end = Date.now() + s.seconds * 1000;
              let n = 0;
              while (Date.now() < end) {
                await act({ type: 'cutTo', screen: 'live', sourceId: nextPic(show().screens.live.program) });
                n++;
                // A quiet stretch: a name now and then.
                if (n % 6 === 0) await act({ type: 'setOverlayOn', channel: 0, value: true });
                await sleep(s.seconds > 30 ? 4000 : 1200);
              }
              note(`${n} cuts`);
              break;
            }
            case 'transitions': {
              let ok = 0;
              for (const k of transitions(env)) {
                const ms = k.startsWith('stinger') ? stingerMs(k) || 1000 : 500;
                const target = await takeWith(k, ms);
                await sleep(ms + 400);
                if (show().screens.live.program !== target) throw new Error(`After the ${k} transition the wrong input was on air`);
                ok++;
              }
              note(`${ok} transitions`);
              break;
            }
            case 'tbar': {
              const target = nextPic(show().screens.live.program);
              await act({ type: 'setPreview', screen: 'live', sourceId: target });
              for (let v = 1; v <= 10; v++) {
                await act({ type: 'setTbar', screen: 'live', value: v / 10 });
                await sleep(150);
              }
              await sleep(300);
              if (show().screens.live.program !== target) throw new Error('The T-bar did not put the input on air');
              break;
            }
            case 'names': {
              await act({ type: 'setOverlayOn', channel: 0, value: true });
              await sleep(1500);
              if (!show().overlays[0]?.on) throw new Error('The name title did not come on');
              await sleep(4000);
              if (show().overlays[0]?.on) {
                note('auto-hide did not take it off; taken off by hand');
                await act({ type: 'setOverlayOn', channel: 0, value: false });
                throw new Error('The name title did not hide by itself after 4 s');
              }
              note('came on and hid by itself');
              await act({ type: 'cutTo', screen: 'live', sourceId: 'test-title' });
              await sleep(1500);
              break;
            }
            case 'scoreboard': {
              await act({ type: 'cutTo', screen: 'live', sourceId: 'test-scoreboard' });
              await act({ type: 'scoreReset', id: 'test-scoreboard' });
              await act({ type: 'score', id: 'test-scoreboard', side: 'home', delta: 1 });
              await act({ type: 'score', id: 'test-scoreboard', side: 'away', delta: 2 });
              await act({ type: 'scoreClock', id: 'test-scoreboard', run: true });
              await sleep(3000);
              await act({ type: 'score', id: 'test-scoreboard', side: 'home', delta: 3 });
              await act({ type: 'scoreClock', id: 'test-scoreboard', run: false });
              const sb = show().sources.find((x) => x.id === 'test-scoreboard')?.kind;
              if (sb?.type === 'scoreboard' && (sb.home.score !== 4 || sb.away.score !== 2))
                throw new Error(`The score was ${sb.home.score}–${sb.away.score}, not 4–2`);
              if (sb?.type === 'scoreboard' && sb.clock.runMs < 2000) throw new Error('The game clock did not run');
              break;
            }
            case 'countdown': {
              await act({ type: 'setCountdownRemaining', id: 'test-countdown', ms: 4000 });
              await act({ type: 'cutTo', screen: 'live', sourceId: 'test-countdown' });
              const after = nextPic(null);
              await act({ type: 'setPreview', screen: 'live', sourceId: after });
              await act({ type: 'startCountdown', id: 'test-countdown' });
              await waitFor('the countdown to reach zero and take Next', () => show().screens.live.program === after, 12_000);
              note('reached zero and took Next');
              break;
            }
            case 'slideshow':
              await act({ type: 'cutTo', screen: 'live', sourceId: 'test-slideshow' });
              for (let k = 0; k < 3; k++) {
                await sleep(1500);
                await act({ type: 'slideNext', id: 'test-slideshow' });
              }
              await sleep(1000);
              break;
            case 'credits':
              await act({ type: 'cutTo', screen: 'live', sourceId: 'test-credits' });
              await act({ type: 'creditsPlay', id: 'test-credits', value: true });
              await sleep(5000);
              await act({ type: 'creditsPlay', id: 'test-credits', value: false });
              break;
            case 'lyrics':
              await act({ type: 'cutTo', screen: 'live', sourceId: 'test-lyrics' });
              await act({ type: 'lyricsGo', id: 'test-lyrics', index: 0 });
              for (let k = 0; k < 3; k++) {
                await sleep(1000);
                await act({ type: 'lyricsNext', id: 'test-lyrics' });
              }
              break;
            case 'split':
              await act({ type: 'cutTo', screen: 'live', sourceId: 'test-split' });
              await sleep(3500);
              break;
            case 'visuals':
              await act({ type: 'cutTo', screen: 'live', sourceId: 'test-visuals' });
              await act({ type: 'visualsStep', step: 1 });
              await sleep(3000);
              break;
            case 'pesukim':
              await act({ type: 'cutTo', screen: 'live', sourceId: 'test-pesukim' });
              for (let k = 0; k < 4; k++) {
                await act({ type: 'pesukimNext', id: 'test-pesukim' });
                await sleep(700);
              }
              break;
            case 'preset':
              await act({ type: 'pickPreset', id: 'test-preset' });
              await sleep(1500);
              if (show().activePreset !== 'test-preset') throw new Error('The preset was not picked');
              await act({ type: 'take', screen: 'live' });
              await sleep(1000);
              await act({ type: 'pickPreset' });
              break;
            case 'blank': {
              await act({ type: 'setBlank', screens: ['live'], value: true });
              await sleep(1200);
              await act({ type: 'setBlank', screens: ['live'], value: false });
              await act({ type: 'fadeToBlack', screen: 'live' });
              await sleep(show().settings.fadeToBlackMs + 600);
              if (!show().screens.live.blank) throw new Error('Fade to black did not go black');
              await act({ type: 'fadeToBlack', screen: 'live' });
              await sleep(show().settings.fadeToBlackMs + 300);
              if (show().screens.live.blank) {
                await act({ type: 'setBlank', screens: ['live'], value: false });
                throw new Error('Fade to black did not come back');
              }
              break;
            }
            case 'backup': {
              // A camera on air loses its picture (pretended): the next one in the lineup must go on air, and say so.
              const [lost, spare] = pics;
              if (!lost || !spare) throw new Error('Two inputs with a picture are needed');
              const before = show().event.backup ?? defaultBackup();
              await act({ type: 'updateEvent', patch: { backup: { ...defaultBackup(), lineup: [lost.id, spare.id], screens: ['live'] } } });
              try {
                await act({ type: 'cutTo', screen: 'live', sourceId: lost.id });
                // The cut above is a take of the operator's, which the lineup never overrules straight away.
                await sleep(MANUAL_GRACE_MS + 500);
                const mark = backupLog.lastId();
                const t = Date.now();
                health.simulate(lost.id, 8000);
                await waitFor(`${spare.name} to go on air in place of ${lost.name}`, () => show().screens.live.program === spare.id, 6000);
                const took = Date.now() - t;
                const said = backupLog.since(mark).find((n) => n.kind === 'switched' && n.from === lost.id && n.to === spare.id);
                if (!said) throw new Error('The switch was made but the operator was not told');
                await waitFor(`${lost.name} to be marked “No signal”`, () => !!show().noSignal?.includes(lost.id), 3000);
                note(`${lost.name} lost: switched to ${spare.name} after ${(took / 1000).toFixed(1)} s, told at once, marked “No signal”`);
              } finally {
                health.endSimulation(lost.id);
                backupLog.settle('live', lost.id);
                await act({ type: 'updateEvent', patch: { backup: before } });
              }
              break;
            }
            case 'replay': {
              const id = await bc().makeReplay(5, 1);
              await act({ type: 'take', screen: 'live', transition: 'fade', durationMs: 400 });
              await act({ type: 'play', id }).catch(() => {});
              await sleep(5000);
              const src = show().sources.find((x) => x.id === id);
              if (src?.kind.type === 'video') replays.push(src.kind.path, ...(src.playlist?.items.map((x) => x.path) ?? []));
              await act({ type: 'cutTo', screen: 'live', sourceId: nextPic(id) });
              note('the last 5 seconds were replayed');
              break;
            }
            case 'background':
            case 'autoframe': {
              const cam = inputs.find((i) => i.kind === 'camera');
              if (!cam) throw new Error('No camera');
              await act({ type: 'cutTo', screen: 'live', sourceId: cam.id });
              phase = 'cuts';
              await sleep(3000);
              phase = s.kind;
              const patch =
                s.kind === 'background'
                  ? { background: { ...defaultBackground(), mode: 'remove' as const } }
                  : { autoFrame: { ...defaultAutoFrame(), enabled: true } };
              await act({ type: 'updateSource', id: cam.id, patch });
              try {
                await sleep(s.seconds * 1000 - 3000);
              } finally {
                await act({
                  type: 'updateSource',
                  id: cam.id,
                  patch: s.kind === 'background' ? { background: defaultBackground() } : { autoFrame: defaultAutoFrame() },
                });
              }
              break;
            }
            case 'captions': {
              const before = show().captions;
              const mic = inputs.find((i) => i.kind === 'microphone');
              await act({ type: 'setCaptions', captions: { ...before, on: true, listen: mic?.id ?? null } });
              try {
                await sleep(s.seconds * 1000);
              } finally {
                await act({ type: 'setCaptions', captions: { ...before, on: false } });
              }
              break;
            }
            case 'panic': {
              const onAir = show().screens.live.program;
              await act({ type: 'panic', value: true });
              await sleep(2000);
              if (!show().panic) throw new Error('PANIC did not come on');
              await act({ type: 'panic', value: false });
              await sleep(1000);
              if (show().panic) throw new Error('PANIC did not go off');
              if (show().screens.live.program !== onAir) throw new Error('After PANIC a different input was on air');
              const target = await takeWith('cut', 0);
              await sleep(500);
              if (show().screens.live.program !== target) throw new Error('Switching did not work after PANIC');
              note('on, off, and switching works again');
              break;
            }
          }
        });
      };

      // Output screens: open, set out, check each draws in step; full screen once.
      const testOutputs = async (note: (s: string) => void) => {
        const already = new Set<string>();
        await new Promise<void>((resolve) => {
          const stop = client.watchOutputs((open) => {
            open.forEach((o) => already.add(o));
            resolve();
          });
          setTimeout(() => {
            stop();
            resolve();
          }, 1000);
        });
        if (await client.multiviewOpen().catch(() => false)) already.add('multiview');
        const names: OutputName[] = ['live', 'back', 'monitor', 'multiview'];
        for (const o of names) {
          const check: OutputCheck = { output: o, opened: false, ownDisplay: false, fps: null, inSync: null, black: null, overlays: null, tally: null };
          outputs.push(check);
          try {
            if (o === 'multiview') await client.openMultiview();
            else await client.openOutput(o);
            check.opened = true;
            if (!already.has(o)) openedOutputs.push(o);
          } catch (e) {
            check.error = e instanceof Error ? e.message : String(e);
          }
        }
        await sleep(2500);
        const arranged = await call<{ extraDisplays: number; windows: [string, boolean][] }>('test_event_arrange_outputs');
        extraDisplays = arranged.extraDisplays;
        for (const [label, full] of arranged.windows) {
          const c = outputs.find((x) => `output-${x.output}` === label);
          if (c) c.ownDisplay = full;
        }
        note(extraDisplays ? `${extraDisplays} extra screen(s)` : 'no extra screens: tested as windows on the main screen');
        // Something on air and a name title on, so there is something to check.
        await act({ type: 'cutTo', screen: 'live', sourceId: pics[0]!.id });
        await act({ type: 'cutTo', screen: 'back', sourceId: pics[1]!.id });
        await act({ type: 'updateOverlay', channel: 0, patch: { autoHideMs: 0 } });
        await act({ type: 'setOverlayOn', channel: 0, value: true });
        await sleep(1500);
        const answers = await probeOutputs(2000);
        await act({ type: 'setOverlayOn', channel: 0, value: false });
        await act({ type: 'updateOverlay', channel: 0, patch: { autoHideMs: 4000 } });
        for (const c of outputs) {
          const a = answers.find((x) => x.output === c.output);
          if (!a) {
            if (c.opened) c.error = c.error ?? 'It did not answer the check (its page may not have loaded).';
            continue;
          }
          Object.assign(c, { fps: a.fps, inSync: a.inSync, black: a.black, overlays: a.overlays, tally: a.tally });
        }
        // Full screen once on the main display (an output that is not on its own screen).
        const win = outputs.find((x) => x.opened && !x.ownDisplay && x.output !== 'monitor');
        if (win) {
          const label = `output-${win.output}`;
          try {
            const on = await call<boolean>('test_event_fullscreen', { label, on: true });
            await sleep(2500);
            const off = await call<boolean>('test_event_fullscreen', { label, on: false });
            fullscreenOk = on && !off;
            note(`full screen ${fullscreenOk ? 'worked' : 'did not work'}`);
          } catch (e) {
            fullscreenOk = false;
            note(`full screen: ${e instanceof Error ? e.message : String(e)}`);
          } finally {
            await call('test_event_arrange_outputs').catch(() => {});
          }
        }
      };

      const probeOutputs = async (ms: number): Promise<ProbeAnswer[]> => {
        const id = Date.now();
        const got: ProbeAnswer[] = [];
        const stop = await listen<ProbeAnswer>(PROBE_RESULT, (e) => {
          if (e.payload.id === id) got.push(e.payload);
        });
        try {
          await emit(PROBE_EVENT, { id, ms });
          await sleep(ms + 2500);
        } finally {
          stop();
        }
        return got;
      };

      // The stream: Lumora's real streaming path, to receivers on this computer.
      const startStream = async (note: (s: string) => void) => {
        preflight = await call<Reach[]>('test_event_preflight').catch(() => []);
        if (preflight.length) note(`checked ${preflight.length} of your destinations (nothing sent)`);
        streamRun.receivers = await call<ReceiverInfo[]>('test_event_receivers', { folder, vertical: env.vertical });
        undo.add('stop the test stream', async () => {
          if (deps.broadcast()?.status.streaming) await deps.broadcast()?.stop('stream');
          await call('test_event_stop_receivers');
        });
        const settings = await client.captureSettings();
        // Only ever this computer.
        if (!settings.destinations.every((d) => d.url.startsWith('rtmp://127.0.0.1:')))
          throw new Error('The test destinations were not local; the stream was not started');
        await bc().saveSettings(settings);
        await sleep(300);
        streamRun.check = {
          name: 'Test receiver',
          vertical: false,
          local: true,
          started: false,
          seconds: 0,
          avgKbps: null,
          minSpeed: null,
          reconnects: 0,
          probe: null,
        };
        streams.push(streamRun.check);
        if (env.vertical) {
          streamRun.vertical = {
            name: 'Test receiver (vertical)',
            vertical: true,
            local: true,
            started: false,
            seconds: 0,
            avgKbps: null,
            minSpeed: null,
            reconnects: 0,
            probe: null,
          };
          streams.push(streamRun.vertical);
        }
        try {
          await bc().start('stream');
          await waitFor('the stream to start', () => !!deps.broadcast()?.status.streaming, 20_000);
        } catch (e) {
          streamRun.check.error = e instanceof Error ? e.message : String(e);
          throw e;
        }
        const st = bc().status.streaming!;
        firstSession = Math.min(firstSession, st.session);
        noteEncoders();
        streamRun.check.started = true;
        streamRun.startedAt = Date.now();
        streamRun.startBytes = st.bytes;
        if (streamRun.vertical) {
          await waitFor('the vertical stream', () => !!deps.broadcast()?.status.vertical, 15_000).catch((e: unknown) => {
            streamRun.vertical!.error = e instanceof Error ? e.message : String(e);
          });
          streamRun.vertical.started = !!bc().status.vertical;
        }
        note(`streaming to ${streamRun.receivers.length} receiver(s) on this computer`);
      };

      const finishStreamStats = () => {
        const c = streamRun.check;
        if (!c || !c.started) return;
        const st = deps.broadcast()?.status.streaming;
        const secs = (Date.now() - streamRun.startedAt) / 1000;
        c.seconds = Math.round(secs);
        if (st && secs > 0) c.avgKbps = ((st.bytes - streamRun.startBytes) * 8) / 1000 / secs;
        const speeds = samples
          .filter((x) => x.t >= streamRun.startedAt - t0 + 5000)
          .map((x) => x.streamSpeed)
          .filter((x): x is number => x !== null);
        c.minSpeed = speeds.length ? Math.round(Math.min(...speeds) * 100) / 100 : null;
        c.reconnects = captureFailures.filter((f) => f.startsWith('stream')).length;
        if (streamRun.vertical) {
          streamRun.vertical.seconds = c.seconds;
          streamRun.vertical.reconnects = captureFailures.filter((f) => f.startsWith('vertical')).length;
        }
      };

      const stopStream = async (note: (s: string) => void) => {
        finishStreamStats();
        if (deps.broadcast()?.status.streaming) await bc().stop('stream');
        await call('test_event_stop_receivers');
        await bc().saveSettings(await client.captureSettings());
        for (const r of streamRun.receivers) {
          const c = r.vertical ? streamRun.vertical : streamRun.check;
          if (!c) continue;
          try {
            c.probe = await call<Probe>('test_event_probe', { file: r.file });
          } catch (e) {
            c.error = e instanceof Error ? e.message : String(e);
          }
        }
        note(streams.map((s) => `${s.vertical ? 'vertical' : 'wide'}: ${s.probe?.frames ?? 0} frames received`).join(', '));
      };

      // The person's own destination, only when they chose and confirmed it: 30 s at most.
      const realDestination = async (note: (s: string) => void) => {
        const id = opts.realDestination!;
        finishStreamStats();
        if (deps.broadcast()?.status.streaming) await bc().stop('stream');
        const name = await call<string>('test_event_real_destination', { id });
        await bc().saveSettings(await client.captureSettings());
        const check: StreamCheck = {
          name,
          vertical: false,
          local: false,
          started: false,
          seconds: 0,
          avgKbps: null,
          minSpeed: null,
          reconnects: 0,
          probe: null,
        };
        streams.push(check);
        const started = Date.now();
        try {
          await bc().start('stream');
          await waitFor('the stream to start', () => !!deps.broadcast()?.status.streaming, 20_000);
          check.started = true;
          const begin = bc().status.streaming!.bytes;
          await sleep(30_000);
          const st = bc().status.streaming;
          check.seconds = Math.round((Date.now() - started) / 1000);
          if (st) check.avgKbps = ((st.bytes - begin) * 8) / 1000 / check.seconds;
          check.minSpeed = st?.speed ?? null;
        } catch (e) {
          check.error = e instanceof Error ? e.message : String(e);
          throw e;
        } finally {
          if (deps.broadcast()?.status.streaming) await bc().stop('stream');
          // Back to the test's own (local) destinations.
          await call('test_event_stop_receivers').catch(() => {});
          await bc().saveSettings(await client.captureSettings());
        }
        note(`streamed ${check.seconds} s to ${name}`);
      };

      try {
        for (const s of plan) await run(s);
      } catch (e) {
        if (!(e instanceof Stopped)) throw e;
        stopped = true;
        // PANIC off and the stream stopped, whatever was happening.
        await act({ type: 'panic', value: false }).catch(() => {});
      }

      // ----- finishing -----
      phase = 'finish';
      if (streamRun.check?.started && !streams.some((s) => s.probe)) {
        await step('finish', 'Stop the stream', 0, stopStream, true).catch(() => {});
      }
      await step(
        'finish',
        'Stop the recording and check the file',
        0,
        async (note) => {
          if (!deps.broadcast()?.status.recording) throw new Error('The recording was not running at the end');
          recording.seconds = (Date.now() - recStartedAt) / 1000;
          const last = bc().status.lastRecording;
          await bc().stop('record');
          await waitForPlain(
            () => !deps.broadcast()?.status.recording && !deps.broadcast()?.status.finishing && deps.broadcast()?.status.lastRecording !== last,
            120_000,
          );
          const files = await call<{ path: string; size: number }[]>('test_event_videos', { folder });
          const newest = deps.broadcast()?.status.lastRecording ?? null;
          const main = files.find((f) => f.path === newest) ?? [...files].sort((a, b) => b.size - a.size)[0];
          if (!main) throw new Error('No recording file was found');
          recording.file = baseName(main.path);
          recording.probe = await call<Probe>('test_event_probe', { file: main.path });
          note(`${recording.probe.frames} frames, ${recording.probe.audioStreams} sound track(s); ${files.length} file(s) in all`);
        },
        true,
      ).catch(() => {});
      if (!recording.probe && !recording.error) recording.error = steps.at(-1)?.error ?? 'The recording could not be checked';
    },
    async () => {
      // After the event is back: let the screens catch up.
      await new Promise((r) => setTimeout(r, 300));
    },
  );

  sampling = false;
  await sampleLoop;
  console.error = original.error;
  console.warn = original.warn;
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onRejection);
  if (session.error instanceof Stopped) stopped = true;
  else if (session.error) error = session.error instanceof Error ? session.error.message : String(session.error);
  for (const u of session.undo) if (!u.ok) consoleLines.push(`ERROR undo “${u.name}” failed: ${scrub(u.error ?? '', 400)}`);
  if (session.restored === null && session.error) throw session.error;

  const camCount = inputs.filter((i) => i.kind === 'camera').length;
  const measured: Measured = {
    ms: at(),
    samples,
    steps,
    outputsTested: opts.outputs,
    outputs,
    extraDisplays,
    fullscreenOk,
    streamTested: opts.stream && env.ffmpeg,
    streams,
    preflight,
    recording,
    diskMBps,
    neededMBps: ownSettings ? neededMBps(ownSettings, camCount) : 1,
    userDrive: opts.userDrive,
    mics: inputs.filter((i) => i.kind === 'microphone').map((i) => ({ id: i.id, name: i.name })),
    problems: [...seenProblems.values()],
    console: consoleLines,
    captureFailures,
    encoders: (noteEncoders(), encoders),
    restored: session.restored,
    stopped,
  };
  if (error && !stopped)
    steps.push({
      kind: 'finish',
      label: 'The test itself',
      round: 0,
      at: at(),
      ms: 0,
      ok: false,
      error,
      stack: session.error instanceof Error ? session.error.stack : undefined,
      notes: [],
    });
  return { measured, inputs, skipped, settings: ownSettings, error };

  async function waitForPlain(ok: () => boolean, ms: number) {
    const end = Date.now() + ms;
    while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 250));
    if (!ok()) throw new Error('Timed out waiting for the recording to finish');
  }
}

function safe(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/** The test show's input for a planned one (null: its media could not be made). */
export function newSource(i: PlannedInput, media: Media | null, all: PlannedInput[]): NewSource | null {
  const base = { id: i.id, name: i.name };
  switch (i.kind) {
    case 'camera':
      return { ...base, kind: { type: 'camera', deviceId: i.deviceId ?? '', label: i.name } };
    case 'microphone':
      return { ...base, kind: { type: 'microphone', deviceId: i.deviceId ?? '', label: i.name } };
    case 'pattern':
      return { ...base, kind: { type: 'pattern' } };
    case 'color':
      return { ...base, kind: { type: 'color', color: '#0b2545' } };
    case 'video':
      return media?.video
        ? {
            ...base,
            looping: true,
            kind: { type: 'video', path: media.video, durationS: media.videoSeconds, playback: { playing: true, posS: 0, at: Date.now() } },
          }
        : null;
    case 'image':
      return media?.image ? { ...base, kind: { type: 'image', path: media.image } } : null;
    case 'slideshow':
      return media?.slides.length
        ? { ...base, kind: { type: 'slideshow', ...defaultSlideshow(), slides: media.slides.map((path) => ({ type: 'image' as const, path })), autoMs: null } }
        : null;
    case 'name': {
      const t = TEXT_TEMPLATES[0]!.make();
      return { ...base, kind: { type: 'text', ...t, text: 'Jordan Rivera', sub: 'Test speaker' } };
    }
    case 'title': {
      const t = (TEXT_TEMPLATES.find((x) => x.layout === 'title') ?? TEXT_TEMPLATES[0]!).make();
      return { ...base, kind: { type: 'text', ...t, text: 'Lumora test event', sub: 'Everything here is a test' } };
    }
    case 'scoreboard':
      return { ...base, kind: { type: 'scoreboard', ...defaultScoreboard() } };
    case 'countdown':
      return {
        ...base,
        kind: { type: 'countdown', background: '#0b2545', timer: { ...defaultCountdown(), lengthMs: 4000, remainingMs: 4000, label: 'Test countdown' } },
      };
    case 'visuals':
      return { ...base, kind: { type: 'visuals' } };
    case 'credits':
      return {
        ...base,
        kind: {
          type: 'credits',
          ...defaultCredits(),
          names: parseNames('Jordan Rivera — Host\nSam Lee — Camera\nAlex Kim — Sound\nRiley Chen — Lights\nTaylor Brooks — Producer'),
        },
      };
    case 'split': {
      const s = defaultSplit();
      const pics = all.filter((x) => x.kind === 'camera' || x.kind === 'pattern' || x.kind === 'color').slice(0, 2);
      return { ...base, kind: { type: 'split', ...s, boxes: s.boxes.map((b, k) => ({ ...b, sourceId: pics[k]?.id ?? null })) } };
    }
    case 'lyrics':
      return {
        ...base,
        kind: {
          type: 'lyrics',
          ...defaultLyrics(),
          title: 'Test song',
          text: 'This is the first verse\nof the Lumora test song\n\nThis is the second verse\nthe show goes on\n\nAnd this is the chorus\nsing it once more',
        },
      };
    case 'pesukim':
      return { ...base, kind: { type: 'pesukim', ...defaultPesukim() } };
  }
}
