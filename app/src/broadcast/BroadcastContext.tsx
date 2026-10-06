import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  defaultCaptureSettings,
  type CaptureFailure,
  type CaptureKind,
  type CaptureSettings,
  type CaptureStatus,
  type EngineClient,
  type SessionKind,
} from '../engine/client';
import type { Show } from '../engine/types/Show';
import { useSound } from '../audio/SoundContext';
import { useProblemStore, useReportProblem } from '../problems/problems';
import { RehearsalLog, type RehearsalReport } from './rehearsal';
import { useSpeakerNames } from '../engine/speakers';
import { due, loadSchedule, saveSchedule, timeText, type Schedule } from './schedule';
import { Broadcaster } from './recorder';
import { replayExt } from './replay';
import { captionTargets, LiveCaptions, type CaptionState } from '../captions/live';
import { lineWidth } from './captionLayer';
import { useAppRequests, useRemoteControl } from './remoteControl';

/** The highlights reel's input. */
export const HIGHLIGHTS = 'highlights-reel';

/** Waits between attempts to bring a dropped stream back (then every 30 s). */
const RETRY_MS = [2000, 4000, 8000, 15000, 30000];

interface Broadcast {
  status: CaptureStatus;
  settings: CaptureSettings;
  saveSettings(s: CaptureSettings): Promise<void>;
  start(kind: CaptureKind): Promise<void>;
  stop(kind: CaptureKind): Promise<void>;
  /** Trying to bring the stream back after it dropped. */
  reconnecting: { attempt: number; message: string } | null;
  /** Starting or stopping right now. */
  busy: Record<CaptureKind, boolean>;
  /** Instant replay is keeping the last minute. */
  replayOn: boolean;
  setReplay(on: boolean): void;
  /** The recording picture's frame rate and dropped frames (null when not drawing). */
  frameStats(): { fps: number; target: number; dropped: number } | null;
  /** Make a replay of the last `seconds` and line it up in Next. Resolves its input's id. */
  makeReplay(seconds: number, speed: number): Promise<string>;
  /** Keep the last `seconds` in the highlights reel (a video input that plays them all). Resolves how many it holds. */
  saveHighlight(seconds: number): Promise<number>;
  /** Live captions: whether they're running, and the words right now. */
  captions: { state: CaptionState; lines(): string[] };
  /** Rehearsal: GO LIVE runs everything as if live, but nothing is sent. */
  rehearsal: boolean;
  setRehearsal(on: boolean): void;
  /** How the last rehearsal went (until closed). */
  rehearsalReport: RehearsalReport | null;
  closeRehearsalReport(): void;
  /** Going live at a set time (null: not planned). */
  schedule: Schedule | null;
  setSchedule(s: Schedule | null): void;
}

const Ctx = createContext<Broadcast | null>(null);

export function useBroadcast(): Broadcast | null {
  return useContext(Ctx);
}

const EMPTY: CaptureStatus = {
  ffmpeg: false,
  recording: null,
  streaming: null,
  vertical: null,
  ndi: null,
  lastRecording: null,
  finishing: false,
  failure: null,
};

/** A file name for a recording: the event and when it started. */
function recordingName(show: Show): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${show.event.name.trim() || 'Lumora'} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

/** Records and streams the Live Screen for the control window. */
export function BroadcastProvider({ show, client, children }: { show: Show; client: EngineClient; children: ReactNode }) {
  const sound = useSound();
  const broadcaster = useMemo(() => (typeof document === 'undefined' ? null : new Broadcaster(client, sound)), [client, sound]);
  useEffect(() => () => broadcaster?.dispose(), [broadcaster]);
  useEffect(() => broadcaster?.setShow(show), [broadcaster, show]);
  const showRef = useRef(show);
  showRef.current = show;

  const [status, setStatus] = useState<CaptureStatus>(EMPTY);
  const [settings, setSettings] = useState<CaptureSettings>(defaultCaptureSettings);
  const [busy, setBusy] = useState<Record<CaptureKind, boolean>>({
    record: false,
    stream: false,
  });
  const [reconnecting, setReconnecting] = useState<{
    attempt: number;
    message: string;
  } | null>(null);
  // The stream has really gone out at least once since GO LIVE was pressed.
  const everLive = useRef(false);
  const [startError, setStartError] = useState<{
    kind: CaptureKind;
    message: string;
  } | null>(null);
  // What the operator wants running; a failure of something wanted is retried.
  const wanted = useRef<Record<CaptureKind, boolean>>({
    record: false,
    stream: false,
  });
  // One retry waiting per kind. Retries are not tied to the status: it changes
  // every second while anything runs, and that must never put a retry off.
  const retries = useRef(new Map<SessionKind, ReturnType<typeof setTimeout>>());
  // The operator starting or stopping by hand replaces any retry still waiting.
  const forget = (kind: CaptureKind) => {
    for (const k of kind === 'stream' ? (['stream', 'vertical'] as const) : [kind]) {
      clearTimeout(retries.current.get(k));
      retries.current.delete(k);
    }
  };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => client.watchCapture(setStatus), [client]);
  useEffect(() => {
    void client.captureSettings().then(setSettings, () => {});
  }, [client]);

  // Sessions left from before this window opened (a reload) have no encoder: end them.
  const checkedOrphans = useRef(false);
  useEffect(() => {
    if (checkedOrphans.current || !broadcaster || status === EMPTY) return;
    checkedOrphans.current = true;
    for (const r of [status.recording, status.streaming, status.vertical, status.ndi]) if (r) void client.captureStop(r.session);
  }, [status, broadcaster, client]);

  // Rehearsal: chosen before going live, never kept (a real event can't start as a rehearsal by mistake).
  const [rehearsal, setRehearsalOn] = useState(false);
  const rehearsalRef = useRef(rehearsal);
  rehearsalRef.current = rehearsal;
  const launch = useCallback(
    async (kind: CaptureKind) => {
      if (!broadcaster) throw new Error('Recording is not available here.');
      const name = recordingName(showRef.current);
      const rehearse = kind === 'stream' && rehearsalRef.current;
      await broadcaster.start(kind, settingsRef.current, name, rehearse);
      // The vertical version starts beside the stream; if it can't, the wide stream carries on.
      if (kind === 'stream')
        void broadcaster.startVertical(settingsRef.current, name, rehearse).then(
          () => setVerticalTrouble(null),
          (e: unknown) => setVerticalTrouble(e instanceof Error ? e.message : String(e)),
        );
    },
    [broadcaster],
  );
  const [verticalTrouble, setVerticalTrouble] = useState<string | null>(null);
  // A graphics-card encoder failed and the processor took over (until Lumora restarts).
  const [encoderFallback, setEncoderFallback] = useState<string | null>(null);

  const start = useCallback(
    async (kind: CaptureKind) => {
      wanted.current[kind] = true;
      forget(kind);
      if (kind === 'stream') everLive.current = false;
      setBusy((b) => ({ ...b, [kind]: true }));
      setStartError(null);
      try {
        await launch(kind);
      } catch (e) {
        wanted.current[kind] = false;
        setStartError({
          kind,
          message: e instanceof Error ? e.message : String(e),
        });
        throw e;
      } finally {
        setBusy((b) => ({ ...b, [kind]: false }));
      }
    },
    [launch],
  );

  const stop = useCallback(
    async (kind: CaptureKind) => {
      wanted.current[kind] = false;
      forget(kind);
      if (kind === 'stream') setReconnecting(null);
      setEncoderFallback(null);
      setBusy((b) => ({ ...b, [kind]: true }));
      try {
        await broadcaster?.stop(kind);
      } finally {
        setBusy((b) => ({ ...b, [kind]: false }));
      }
    },
    [broadcaster],
  );

  // A session that failed: stop its encoder, and try again while it is still wanted.
  const attempts = useRef<Record<CaptureKind, number>>({
    record: 0,
    stream: 0,
  });
  const later = useCallback((kind: SessionKind, ms: number, run: () => void) => {
    clearTimeout(retries.current.get(kind));
    retries.current.set(
      kind,
      setTimeout(() => {
        retries.current.delete(kind);
        run();
      }, ms),
    );
  }, []);
  useEffect(() => {
    const pending = retries.current;
    return () => {
      for (const id of pending.values()) clearTimeout(id);
      pending.clear();
    };
  }, []);
  const onFailure = useCallback(
    (failure: CaptureFailure) => {
      if (!broadcaster) return;
      const { session, message } = failure;
      // The NDI output stopped: it is brought back by itself (see below).
      if (failure.kind === 'ndi') {
        broadcaster.abandon('ndi', session);
        setNdiTrouble(message);
        return;
      }
      // The vertical version dropped: bring it back while the stream runs.
      if (failure.kind === 'vertical') {
        broadcaster.abandon('vertical', session);
        if (!wanted.current.stream) return;
        setVerticalTrouble(message);
        later('vertical', 5000, () => {
          if (!wanted.current.stream) return;
          void broadcaster
            .stop('vertical')
            .then(() => broadcaster.startVertical(settingsRef.current, recordingName(showRef.current), rehearsalRef.current))
            .then(
              () => setVerticalTrouble(null),
              (e: unknown) => setVerticalTrouble(e instanceof Error ? e.message : String(e)),
            );
        });
        return;
      }
      const kind = failure.kind;
      broadcaster.abandon(kind, session);
      if (!wanted.current[kind]) return;
      // The graphics card's encoder failed: started again at once with the processor's
      // (a recording goes on in a new file). Not counted as a retry.
      if (failure.fallback) {
        setEncoderFallback(message);
        later(kind, 500, () => {
          if (!wanted.current[kind]) return;
          void broadcaster.stop(kind).then(() => launch(kind).catch(() => {}));
        });
        return;
      }
      // It never got going (first try): say so plainly instead of retrying in the background.
      if (kind === 'stream' && failure.neverStarted && !everLive.current) {
        wanted.current.stream = false;
        void broadcaster.stop('stream');
        setStartError({ kind, message: failure.message });
        return;
      }
      const n = attempts.current[kind]++;
      // A recording is restarted once (into a new file); a stream keeps trying.
      if (kind === 'record' && n >= 1) {
        wanted.current.record = false;
        return;
      }
      if (kind === 'stream') setReconnecting({ attempt: n + 1, message });
      later(kind, RETRY_MS[Math.min(n, RETRY_MS.length - 1)]!, () => {
        if (!wanted.current[kind]) return;
        void broadcaster.stop(kind).then(() => launch(kind).catch(() => {}));
      });
    },
    [broadcaster, launch, later],
  );
  // Each failure is handled once, however often the status repeats it.
  const handled = useRef(new Set<string>());
  const failure = status.failure;
  const failures = status.failures;
  useEffect(() => {
    for (const f of failures ?? (failure ? [failure] : [])) {
      const key = `${f.kind}:${f.session}`;
      if (handled.current.has(key)) continue;
      handled.current.add(key);
      onFailure(f);
    }
  }, [failure, failures, onFailure]);
  // The encoder itself stopped (the app still waits for it): handled the same way.
  useEffect(() => {
    if (!broadcaster) return;
    broadcaster.onLost = (kind, session, message) => {
      const key = `${kind}:${session}`;
      if (handled.current.has(key)) return;
      handled.current.add(key);
      onFailure({ kind, session, message });
    };
    return () => {
      broadcaster.onLost = null;
    };
  }, [broadcaster, onFailure]);
  // Running again: forget the failed attempts.
  useEffect(() => {
    if (status.streaming?.speed != null) everLive.current = true;
  }, [status.streaming?.speed]);
  useEffect(() => {
    if (status.streaming) {
      attempts.current.stream = 0;
      setReconnecting(null);
    }
    if (status.recording) attempts.current.record = 0;
  }, [status.streaming, status.recording]);

  useEffect(() => {
    if (status.vertical) setVerticalTrouble(null);
  }, [status.vertical]);

  // ---- tell the operator ----
  useReportProblem(
    verticalTrouble && status.streaming
      ? {
          key: 'stream:vertical',
          level: 'warning',
          title: 'The vertical stream is not running',
          detail: verticalTrouble,
          fix: 'The wide stream carries on. Lumora keeps trying; check the vertical destinations in Settings → Recording and streaming.',
        }
      : null,
  );
  useReportProblem(
    reconnecting
      ? {
          key: 'stream',
          level: 'error',
          title: `The stream dropped — reconnecting (attempt ${reconnecting.attempt})`,
          detail: reconnecting.message,
          fix: 'Lumora keeps trying by itself. Check the internet connection; press LIVE to stop trying.',
        }
      : null,
  );
  useReportProblem(
    encoderFallback
      ? {
          key: 'encoder:fallback',
          level: 'warning',
          title: 'The graphics card’s encoder stopped — the processor took over',
          detail: encoderFallback,
          fix: 'Recording and streaming carry on with the processor’s encoder (a recording goes on in a new file). Update the graphics driver, or choose Software in Settings → Recording and streaming → Encoder; restart Lumora to try the graphics card again.',
        }
      : null,
  );
  const dropped = [...(status.streaming?.dropped ?? []), ...(status.vertical?.dropped ?? [])];
  useReportProblem(
    dropped.length
      ? {
          key: 'stream:dropped',
          level: 'warning',
          title: `${dropped.join(', ')} dropped out of the stream`,
          detail: 'The other destinations carry on.',
          fix: 'Check that destination’s stream key and that its live event is still open. Stop and start the stream to try it again.',
        }
      : null,
  );
  const recordFailed = failure?.kind === 'record' && !status.recording && !wanted.current.record ? failure : null;
  useReportProblem(
    recordFailed
      ? {
          key: 'recording',
          level: 'error',
          title: 'The recording stopped',
          detail: recordFailed.message,
          fix: 'Check there is space on the disk, then press REC to record again.',
        }
      : null,
  );
  const slow = status.streaming?.speed != null && status.streaming.speed < 0.93;
  useReportProblem(
    slow
      ? {
          key: 'stream:slow',
          level: 'warning',
          title: 'The internet is too slow for this stream',
          detail: `The stream is only getting ${Math.round((status.streaming?.speed ?? 0) * 100)}% of the speed it needs, so viewers may see it stop and start.`,
          fix: 'Use a wired connection, or choose a lower quality in Settings → Recording and streaming (for the next stream).',
        }
      : null,
  );
  // A failed start is news, not a lasting state: it clears after a while.
  useEffect(() => {
    if (!startError) return;
    const id = setTimeout(() => setStartError(null), 20000);
    return () => clearTimeout(id);
  }, [startError]);
  useReportProblem(
    startError
      ? {
          key: `capture-start:${startError.kind}`,
          level: 'error',
          title: startError.kind === 'record' ? 'Recording could not start' : 'The stream could not start',
          detail: startError.message,
        }
      : null,
  );

  const saveSettings = useCallback(
    async (s: CaptureSettings) => {
      setSettings(await client.setCaptureSettings(s));
    },
    [client],
  );

  const [replayOn, setReplayOn] = useState(false);
  const setReplay = useCallback(
    (on: boolean) => {
      if (!broadcaster) return;
      try {
        if (on) broadcaster.startReplay();
        else broadcaster.stopReplay();
        setReplayOn(broadcaster.replaying);
      } catch (e) {
        setStartError({ kind: 'record', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [broadcaster],
  );
  const makeReplay = useCallback(
    async (seconds: number, speed: number) => {
      if (!broadcaster?.replaying) throw new Error('Turn on instant replay first.');
      const pieces = await broadcaster.takeReplay(seconds);
      if (!pieces.length) throw new Error('Nothing to replay yet: wait a few seconds.');
      const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const tag = Date.now().toString(36);
      const items = await Promise.all(
        pieces.map(async (p, i) => ({
          path: await client.saveReplay(p.blob, `replay-${tag}-${i + 1}.${replayExt(p.blob.type)}`),
          name: `Replay ${stamp} (${i + 1})`,
          durationS: (p.end - p.start) / 1000,
        })),
      );
      const id = `replay-${tag}`;
      const first = items[0]!;
      await client.dispatch({
        type: 'addSource',
        source: {
          id,
          name: `Replay ${stamp}`,
          kind: { type: 'video', path: first.path, durationS: first.durationS, playback: { playing: false, posS: 0, at: 0 } },
          // Slow-motion sound is rarely wanted: the replay starts muted.
          muted: speed !== 1,
        },
      });
      await client.dispatch({ type: 'setPlaylist', id, playlist: { items, current: 0, autoNext: true, loopAll: false } });
      if (speed !== 1) await client.dispatch({ type: 'setSpeed', id, speed });
      await client.dispatch({ type: 'setPreview', screen: 'live', sourceId: id });
      return id;
    },
    [broadcaster, client],
  );

  const saveHighlight = useCallback(
    async (seconds: number) => {
      if (!broadcaster?.replaying) throw new Error('Turn on instant replay first.');
      const pieces = await broadcaster.takeReplay(seconds);
      if (!pieces.length) throw new Error('Nothing to keep yet: wait a few seconds.');
      const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const tag = Date.now().toString(36);
      const items = await Promise.all(
        pieces.map(async (p, i) => ({
          path: await client.saveReplay(p.blob, `highlight-${tag}-${i + 1}.${replayExt(p.blob.type)}`),
          name: `Highlight ${stamp}`,
          durationS: (p.end - p.start) / 1000,
        })),
      );
      const reel = showRef.current.sources.find((s) => s.id === HIGHLIGHTS);
      const before = reel?.playlist?.items ?? [];
      const all = [...before, ...items];
      if (!reel) {
        const first = items[0]!;
        await client.dispatch({
          type: 'addSource',
          source: {
            id: HIGHLIGHTS,
            name: 'Highlights reel',
            kind: { type: 'video', path: first.path, durationS: first.durationS, playback: { playing: false, posS: 0, at: 0 } },
          },
        });
      }
      await client.dispatch({ type: 'setPlaylist', id: HIGHLIGHTS, playlist: { items: all, current: 0, autoNext: true, loopAll: false } });
      return new Set(all.map((x) => x.name)).size;
    },
    [broadcaster, client],
  );

  // ---- NDI output: kept running while it is switched on ----
  const [ndiTrouble, setNdiTrouble] = useState<string | null>(null);
  const ndiWanted = !!settings.ndi;
  const ndiRunning = !!status.ndi;
  useEffect(() => {
    if (!broadcaster) return;
    if (!ndiWanted) {
      setNdiTrouble(null);
      if (ndiRunning) void broadcaster.stop('ndi');
      return;
    }
    if (ndiRunning) {
      setNdiTrouble(null);
      return;
    }
    // Start now, or try again a little later after a problem.
    const id = setTimeout(
      () =>
        void broadcaster
          .stop('ndi')
          .then(() => broadcaster.startNdi(settingsRef.current))
          .catch((e: unknown) => setNdiTrouble(e instanceof Error ? e.message : String(e))),
      ndiTrouble ? 5000 : 0,
    );
    return () => clearTimeout(id);
  }, [broadcaster, ndiWanted, ndiRunning, ndiTrouble]);
  useReportProblem(
    ndiWanted && ndiTrouble && !ndiRunning
      ? {
          key: 'ndi:out',
          level: 'warning',
          title: 'The NDI output isn’t running',
          detail: ndiTrouble,
          fix: 'Lumora keeps trying. NDI needs the free NDI Tools on this computer (ndi.video/tools).',
        }
      : null,
  );

  // Speakers' names come on by themselves when they talk.
  useSpeakerNames(show, client);

  // ---- live captions (to the stream only) ----
  const live = useMemo(() => (sound && typeof Worker !== 'undefined' ? new LiveCaptions(client, sound) : null), [client, sound]);
  const [captionState, setCaptionState] = useState<CaptionState>({ state: 'off' });
  const statusRef = useRef(status);
  statusRef.current = status;
  const cc = show.captions;
  useEffect(() => {
    if (!live) return;
    live.onState = setCaptionState;
    // A rehearsal sends no captions either.
    live.sendTo = () => (rehearsalRef.current ? [] : captionTargets(settingsRef.current, statusRef.current));
    return () => live.stop();
  }, [live]);
  useEffect(() => {
    if (!live) return;
    if (cc?.on) void live.start(cc.listen ?? null, cc.language ?? 'en', cc.best ?? false);
    else live.stop();
  }, [live, cc?.on, cc?.listen, cc?.language, cc?.best]);
  const ccRef = useRef(cc);
  ccRef.current = cc;
  useEffect(() => {
    if (!broadcaster) return;
    broadcaster.captionsInPicture = () => {
      const c = ccRef.current;
      if (!live || !c?.on || !c.inPicture) return null;
      return { lines: live.lines.shown(c.lines, lineWidth(1920, 1080, c.size)), look: c };
    };
  }, [broadcaster, live]);
  useReportProblem(
    captionState.state === 'failed' && cc?.on
      ? {
          key: 'captions',
          level: 'warning',
          title: 'Live captions stopped',
          detail: captionState.message,
          fix: 'The stream carries on without them. Turn captions off and on again (Settings → Live captions).',
        }
      : null,
  );
  const captionLines = useCallback(() => (live && cc ? live.lines.shown(cc.lines, lineWidth(1920, 1080, cc.size)) : []), [live, cc]);
  const captions = useMemo(() => ({ state: captionState, lines: captionLines }), [captionState, captionLines]);

  const frameStats = useCallback(() => broadcaster?.frameStats() ?? null, [broadcaster]);

  // ---- rehearsal ----
  const setRehearsal = useCallback((on: boolean) => {
    // Not while the stream runs: stop it first.
    if (!statusRef.current.streaming) setRehearsalOn(on);
  }, []);
  const problems = useProblemStore();
  const [rehearsalReport, setRehearsalReport] = useState<RehearsalReport | null>(null);
  const rehearsing = rehearsal && !!status.streaming;
  useEffect(() => {
    if (!rehearsing) return;
    const log = new RehearsalLog();
    const look = () => {
      log.problems(problems?.snapshot() ?? []);
      log.sample(broadcaster?.frameStats()?.dropped ?? null, statusRef.current.streaming?.speed ?? null);
    };
    const unsub = problems?.subscribe(look);
    const id = setInterval(look, 2000);
    return () => {
      unsub?.();
      clearInterval(id);
      look();
      setRehearsalReport(log.report());
    };
  }, [rehearsing, problems, broadcaster]);
  const closeRehearsalReport = useCallback(() => setRehearsalReport(null), []);

  // ---- go live at a set time ----
  const [schedule, setScheduleState] = useState<Schedule | null>(() => (typeof localStorage === 'undefined' ? null : loadSchedule()));
  const setSchedule = useCallback((s: Schedule | null) => {
    saveSchedule(s);
    setScheduleState(s);
  }, []);
  const begun = useRef(false);
  useEffect(() => {
    begun.current = false;
    if (!schedule) return;
    const tick = () => {
      const now = Date.now();
      const step = due(schedule, now);
      if (step === 'wait') return;
      const show = showRef.current;
      // The countdown input that counts to the start (the first one there is).
      const countdown = show.sources.find((x) => x.kind.type === 'countdown');
      if (!begun.current) {
        begun.current = true;
        if (countdown && step === 'start') {
          void client.dispatch({ type: 'countdownTo', id: countdown.id, at: schedule.at });
          void client.dispatch({ type: 'cutTo', screen: 'live', sourceId: countdown.id });
        }
        if (!statusRef.current.streaming) void start('stream').catch(() => {});
      }
      if (step === 'time') {
        // With a countdown on air, it goes to Next by itself at zero; without one, Lumora takes Next.
        const onAir = show.screens.live.program;
        if (!countdown || onAir !== countdown.id) {
          if (show.screens.live.preview) void client.dispatch({ type: 'take', screen: 'live' });
        }
        setSchedule(null);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [schedule, client, start, setSchedule]);
  useReportProblem(
    schedule
      ? {
          key: 'schedule',
          level: 'warning',
          title: `Going live by itself at ${timeText(schedule.at)}`,
          detail: `The stream starts at ${timeText(schedule.at - schedule.earlyMin * 60_000)} with the countdown on screen; at ${timeText(schedule.at)} what is lined up in Next goes on air. Keep Lumora open.`,
          action: { label: 'Cancel it', run: () => setSchedule(null) },
        }
      : null,
  );
  const value = useMemo<Broadcast>(
    () => ({
      status,
      settings,
      saveSettings,
      start,
      stop,
      reconnecting,
      busy,
      replayOn,
      setReplay,
      makeReplay,
      saveHighlight,
      frameStats,
      captions,
      rehearsal,
      setRehearsal,
      rehearsalReport,
      closeRehearsalReport,
      schedule,
      setSchedule,
    }),
    [
      status,
      settings,
      saveSettings,
      start,
      stop,
      reconnecting,
      busy,
      replayOn,
      setReplay,
      makeReplay,
      saveHighlight,
      frameStats,
      captions,
      rehearsal,
      setRehearsal,
      rehearsalReport,
      closeRehearsalReport,
      schedule,
      setSchedule,
    ],
  );
  // The Stream Deck (through the phone remote's server) records, goes live and replays too.
  useRemoteControl(value);
  // Macros, triggers and cues record, go live and replay through the same requests.
  useAppRequests(show.appRequests ?? [], value, (message, r) => setStartError({ kind: r.step.command === 'record' ? 'record' : 'stream', message }));
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
