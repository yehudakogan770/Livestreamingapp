// The show as it is called, kept in step with the server: its state, the
// timings, and this device's clock lined up with the server's (so every
// screen shows the same seconds).

import { useCallback, useEffect, useRef, useState } from 'react';
import * as pro from './apiPro';
import { clockOffset, type Live, type LogEntry } from './live';
import { db } from './session';

export interface LiveStore {
  live: Live | null;
  log: LogEntry[];
  /** ms to add to Date.now() for the server's clock. */
  offset: number;
  error: string;
  busy: boolean;
  /** The server has the show-day tools. */
  ready: boolean;
  act: (action: pro.LiveAction, opts?: Parameters<typeof pro.liveGo>[3]) => Promise<void>;
  clearRun: (runId: string) => Promise<void>;
}

/** The server's time now (ms), from this device's clock and the offset. */
export const serverNow = (offset: number): number => Date.now() + offset;

/** Ticks every `ms` while `on` (for timers on screen). */
export function useTick(ms = 250, on = true): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, on]);
  return t;
}

export function useLive(planId: string, enabled = true): LiveStore {
  const [live, setLive] = useState<Live | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(true);
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let on = true;
    setLive(null);
    setLog([]);
    Promise.all([pro.loadLive(db(), planId), pro.loadLog(db(), planId)])
      .then(([l, g]) => {
        if (!on) return;
        setLive(l);
        setLog(g);
        setReady(true);
      })
      .catch((e: unknown) => {
        if (!on) return;
        const m = e instanceof Error ? e.message : String(e);
        if (/update-10/.test(m)) setReady(false);
        else setError(m);
      });
    pro
      .serverClock(db())
      .then(({ server, sent, got }) => on && setOffset(clockOffset(server, sent, got)))
      .catch(() => {});
    const stop = pro.watchLive(db(), planId, {
      live: (l) => {
        if (l.updatedAt < latest.current) return;
        latest.current = l.updatedAt;
        setLive(l);
      },
      log: (e) => setLog((list) => (list.some((x) => x.id === e.id) ? list.map((x) => (x.id === e.id ? e : x)) : [...list, e])),
      logGone: (id) => setLog((list) => list.filter((x) => x.id !== id)),
    });
    return () => {
      on = false;
      stop();
    };
  }, [planId, enabled]);

  const act = useCallback(
    async (action: pro.LiveAction, opts: Parameters<typeof pro.liveGo>[3] = {}) => {
      setBusy(true);
      setError('');
      const sent = Date.now();
      try {
        const r = await pro.liveGo(db(), planId, action, opts);
        setOffset(clockOffset(r.serverNow, sent, Date.now()));
        latest.current = r.live.updatedAt;
        setLive(r.live);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [planId],
  );

  const clearRun = useCallback(
    async (runId: string) => {
      try {
        await pro.clearLog(db(), planId, runId);
        setLog((list) => list.filter((e) => e.runId !== runId));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [planId],
  );

  return { live, log, offset, error, busy, ready, act, clearRun };
}
