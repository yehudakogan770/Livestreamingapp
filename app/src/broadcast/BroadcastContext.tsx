import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  defaultCaptureSettings,
  type CaptureKind,
  type CaptureSettings,
  type CaptureStatus,
  type EngineClient,
} from "../engine/client";
import type { Show } from "../engine/types/Show";
import { useSound } from "../audio/SoundContext";
import { useReportProblem } from "../problems/problems";
import { Broadcaster } from "./recorder";

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
}

const Ctx = createContext<Broadcast | null>(null);

export function useBroadcast(): Broadcast | null {
  return useContext(Ctx);
}

const EMPTY: CaptureStatus = {
  ffmpeg: false,
  recording: null,
  streaming: null,
  lastRecording: null,
  finishing: false,
  failure: null,
};

/** A file name for a recording: the event and when it started. */
function recordingName(show: Show): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${show.event.name.trim() || "Lumora"} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

/** Records and streams the Live Screen for the control window. */
export function BroadcastProvider({
  show,
  client,
  children,
}: {
  show: Show;
  client: EngineClient;
  children: ReactNode;
}) {
  const sound = useSound();
  const broadcaster = useMemo(
    () =>
      typeof document === "undefined" ? null : new Broadcaster(client, sound),
    [client, sound],
  );
  useEffect(() => () => broadcaster?.dispose(), [broadcaster]);
  useEffect(() => broadcaster?.setShow(show), [broadcaster, show]);
  const showRef = useRef(show);
  showRef.current = show;

  const [status, setStatus] = useState<CaptureStatus>(EMPTY);
  const [settings, setSettings] = useState<CaptureSettings>(
    defaultCaptureSettings,
  );
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
    for (const r of [status.recording, status.streaming])
      if (r) void client.captureStop(r.session);
  }, [status, broadcaster, client]);

  const launch = useCallback(
    async (kind: CaptureKind) => {
      if (!broadcaster) throw new Error("Recording is not available here.");
      await broadcaster.start(
        kind,
        settingsRef.current,
        recordingName(showRef.current),
      );
    },
    [broadcaster],
  );

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
      if (kind === "stream") setReconnecting(null);
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
    const { kind, session, message } = failure;
    broadcaster.abandon(kind, session);
    if (!wanted.current[kind]) return;
    const n = attempts.current[kind]++;
    // A recording is restarted once (into a new file); a stream keeps trying.
    if (kind === "record" && n >= 1) {
      wanted.current.record = false;
      return;
    }
    if (kind === "stream") setReconnecting({ attempt: n + 1, message });
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

  // ---- tell the operator ----
  useReportProblem(
    reconnecting
      ? {
          key: "stream",
          level: "error",
          title: `The stream dropped — reconnecting (attempt ${reconnecting.attempt})`,
          detail: reconnecting.message,
          fix: "Lumora keeps trying by itself. Check the internet connection; press LIVE to stop trying.",
        }
      : null,
  );
  const recordFailed =
    failure?.kind === "record" && !status.recording && !wanted.current.record
      ? failure
      : null;
  useReportProblem(
    recordFailed
      ? {
          key: "recording",
          level: "error",
          title: "The recording stopped",
          detail: recordFailed.message,
          fix: "Check there is space on the disk, then press REC to record again.",
        }
      : null,
  );
  const slow = status.streaming?.speed != null && status.streaming.speed < 0.93;
  useReportProblem(
    slow
      ? {
          key: "stream:slow",
          level: "warning",
          title: "The internet is too slow for this stream",
          detail: `The stream is only getting ${Math.round((status.streaming?.speed ?? 0) * 100)}% of the speed it needs, so viewers may see it stop and start.`,
          fix: "Use a wired connection, or choose a lower quality in Settings → Recording and streaming (for the next stream).",
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
          level: "error",
          title:
            startError.kind === "record"
              ? "Recording could not start"
              : "The stream could not start",
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

  const value = useMemo<Broadcast>(
    () => ({ status, settings, saveSettings, start, stop, reconnecting, busy }),
    [status, settings, saveSettings, start, stop, reconnecting, busy],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
