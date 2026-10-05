import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { defaultCaptureSettings, type CaptureKind, type CaptureSettings, type CaptureStatus, type EngineClient } from '../engine/client';
import type { Show } from '../engine/types/Show';
import { useSound } from '../audio/SoundContext';
import { useProblemStore, useReportProblem } from '../problems/problems';
import { RehearsalLog, type RehearsalReport } from './rehearsal';
import { Broadcaster } from './recorder';
import { captionTargets, LiveCaptions, type CaptionState } from '../captions/live';
import { lineWidth } from './captionLayer';

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
  const [startError, setStartError] = useState<{
    kind: CaptureKind;
    message: string;
  } | null>(null);
  // What the operator wants running; a failure of something wanted is retried.
  const wanted = useRef<Record<CaptureKind, boolean>>({
    record: false,
    stream: false,
  });
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
    for (const r of [status.recording, status.streaming, status.vertical]) if (r) void client.captureStop(r.session);
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

  const start = useCallback(
    async (kind: CaptureKind) => {
      wanted.current[kind] = true;
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
      if (kind === 'stream') setReconnecting(null);
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
  const failure = status.failure;
  useEffect(() => {
    if (!failure || !broadcaster) return;
    const { session, message } = failure;
    // The vertical version dropped: bring it back while the stream runs.
    if (failure.kind === 'vertical') {
      broadcaster.abandon('vertical', session);
      if (!wanted.current.stream) return;
      setVerticalTrouble(message);
      const id = setTimeout(() => {
        if (!wanted.current.stream) return;
        void broadcaster
          .stop('vertical')
          .then(() => broadcaster.startVertical(settingsRef.current, recordingName(showRef.current), rehearsalRef.current))
          .then(
            () => setVerticalTrouble(null),
            (e: unknown) => setVerticalTrouble(e instanceof Error ? e.message : String(e)),
          );
      }, 5000);
      return () => clearTimeout(id);
    }
    const kind = failure.kind;
    broadcaster.abandon(kind, session);
    if (!wanted.current[kind]) return;
    const n = attempts.current[kind]++;
    // A recording is restarted once (into a new file); a stream keeps trying.
    if (kind === 'record' && n >= 1) {
      wanted.current.record = false;
      return;
    }
    if (kind === 'stream') setReconnecting({ attempt: n + 1, message });
    const id = setTimeout(
      () => {
        if (!wanted.current[kind]) return;
        void broadcaster.stop(kind).then(() => launch(kind).catch(() => {}));
      },
      RETRY_MS[Math.min(n, RETRY_MS.length - 1)],
    );
    return () => clearTimeout(id);
  }, [failure, broadcaster, launch]);
  // Running again: forget the failed attempts.
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
          path: await client.saveReplay(p.blob, `replay-${tag}-${i + 1}.webm`),
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
          path: await client.saveReplay(p.blob, `highlight-${tag}-${i + 1}.webm`),
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
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
