// Control surfaces (the Stream Deck plugin) start and stop the recording and
// the stream, choose rehearsal and make instant replays through the phone
// remote's server. Those run here, in the control window: the server passes
// each request on ("remote-command"), and this window tells the server what
// is running so every key shows it.

import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { CaptureKind, CaptureSettings, CaptureStatus } from '../engine/client';
import type { AppRequest } from '../engine/types/AppRequest';

/** What the server passes on (see `AppCommand` in src-tauri/src/remote.rs). */
export type RemoteCommand =
  | { command: 'record' | 'stream' | 'rehearsal' | 'replayBuffer'; on: boolean }
  | { command: 'replay'; seconds: number; slow?: boolean };

/** The parts of recording and streaming a control surface can use. */
export interface RemoteOps {
  status: CaptureStatus;
  settings: CaptureSettings;
  busy: Record<CaptureKind, boolean>;
  rehearsal: boolean;
  replayOn: boolean;
  start(kind: CaptureKind): Promise<void>;
  stop(kind: CaptureKind): Promise<void>;
  setRehearsal(on: boolean): void;
  setReplay(on: boolean): void;
  makeReplay(seconds: number, speed: number): Promise<string>;
}

/** Do what a control surface asked. Already so: nothing happens. */
export async function runRemoteCommand(cmd: RemoteCommand, ops: RemoteOps): Promise<void> {
  switch (cmd.command) {
    case 'record': {
      const running = !!ops.status.recording;
      if (ops.busy.record || running === cmd.on) return;
      return cmd.on ? ops.start('record') : ops.stop('record');
    }
    case 'stream': {
      const running = !!ops.status.streaming;
      if (ops.busy.stream || running === cmd.on) return;
      if (cmd.on && !ops.rehearsal && !ops.settings.destinations.some((d) => d.enabled && d.url.trim()))
        throw new Error('Choose where to stream first (Settings → Recording and streaming).');
      return cmd.on ? ops.start('stream') : ops.stop('stream');
    }
    case 'rehearsal':
      if (ops.rehearsal === cmd.on) return;
      if (ops.status.streaming) throw new Error('Rehearsal is chosen before going live.');
      return ops.setRehearsal(cmd.on);
    case 'replayBuffer':
      if (ops.replayOn !== cmd.on) ops.setReplay(cmd.on);
      return;
    case 'replay':
      await ops.makeReplay(cmd.seconds, cmd.slow ? 0.5 : 1);
      return;
  }
}

export interface RemoteAppState {
  recording: boolean;
  streaming: boolean;
  rehearsal: boolean;
  replay: boolean;
  busy: boolean;
  error: { message: string; at: number } | null;
}

/** What the control window tells control surfaces. */
export function remoteAppState(ops: RemoteOps, error: RemoteAppState['error']): RemoteAppState {
  return {
    recording: !!ops.status.recording,
    streaming: !!ops.status.streaming,
    rehearsal: ops.rehearsal,
    replay: ops.replayOn,
    busy: ops.busy.record || ops.busy.stream,
    error,
  };
}

const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** In the Lumora app: take requests from control surfaces, and tell them what is running. */
export function useRemoteControl(ops: RemoteOps): void {
  const ref = useRef(ops);
  ref.current = ops;
  const [error, setError] = useState<RemoteAppState['error']>(null);
  useEffect(() => {
    if (!inApp()) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void listen<RemoteCommand>('remote-command', (e) => {
      runRemoteCommand(e.payload, ref.current).catch((err: unknown) => setError({ message: err instanceof Error ? err.message : String(err), at: Date.now() }));
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  const state = remoteAppState(ops, error);
  const text = JSON.stringify(state);
  useEffect(() => {
    if (inApp()) void invoke('remote_app_state', { appState: JSON.parse(text) as RemoteAppState }).catch(() => {});
  }, [text]);
}

/**
 * Requests left in the show by macros, triggers, cues and buttons (recording,
 * streaming, replay) that are newer than `seen`. Each runs once: requests there
 * when the window opened are never run again.
 */
export function newRequests(list: readonly AppRequest[], seen: number): { todo: AppRequest[]; seen: number } {
  const todo = list.filter((r) => r.seq > seen).sort((a, b) => a.seq - b.seq);
  return { todo, seen: Math.max(seen, ...list.map((r) => r.seq)) };
}

/** Carry out the show's requests for the control window, one after another. */
export function useAppRequests(list: readonly AppRequest[], ops: RemoteOps, onError: (message: string, request: AppRequest) => void): void {
  const ref = useRef(ops);
  ref.current = ops;
  const errRef = useRef(onError);
  errRef.current = onError;
  // Those already there when the window opened (a reload) are not run again.
  const seen = useRef<number | null>(null);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    if (seen.current === null) {
      seen.current = newRequests(list, 0).seen;
      return;
    }
    const { todo, seen: next } = newRequests(list, seen.current);
    seen.current = next;
    for (const r of todo) {
      queue.current = queue.current
        .then(() => runRemoteCommand(r.step, ref.current))
        .catch((e: unknown) => errRef.current(e instanceof Error ? e.message : String(e), r));
    }
  }, [list]);
}
