// Settings → Engine: Standard (each window draws its own copy of every
// screen and opens its own cameras: the default) or Unified (beta): one
// native engine (crates/live-engine) opens each camera once, draws each screen
// once on the graphics card and feeds the outputs. See docs/ENGINE.md.
//
// In Unified mode this window never opens a camera itself: camera pictures
// are the engine's small previews (useEnginePreview), and each input's health
// for the backup lineup comes from the engine (watchEngineHealth).

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { isInsideLumora, type CaptureRunning, type SessionKind } from './client';
import { inputHealth, type InputHealth } from './inputHealth';

export type EngineMode = 'standard' | 'unified';

/** How one of the engine's encoder feeds is doing. */
export interface EngineFeedStats {
  framesIn: number;
  framesDropped: number;
  bytesOut: number;
  /** Sound samples written (silence included), and silence filled in. */
  audioSamples: number;
  audioSilence: number;
  error: string | null;
}

export interface EngineStats {
  frames: number;
  /** Frames drawn in the last second. */
  fps: number;
  msPerFrame: number;
  uploadMs: number;
  renderMs: number;
  presentMs: number;
  readbackMs: number;
  lateFrames: number;
  uploadMbPerS: number;
  adapter: { name: string; backend: string; kind: string } | null;
  outputs: string[];
  feed: EngineFeedStats | null;
  /** Every feed: the recording, the stream, the vertical version, NDI (screens) and each camera's ISO file (inputs). */
  feeds: { id: number; kind: 'screen' | 'vertical' | 'input'; stats: EngineFeedStats | null; error: string | null }[];
  /** The graphics from the overlay renderers. */
  overlay: { framesPerS: number; mbPerS: number; latencyMs: number; planes: number; refused: number };
  notes: string[];
  error: string | null;
  /** Times the graphics card was reset (a driver reset) and the engine started again on it. */
  recoveries?: number;
}

export interface EngineInfo {
  mode: EngineMode;
  running: boolean;
  /** The size and rate the engine draws every screen at (null when it isn't running). */
  size: { width: number; height: number; fps: number } | null;
  error: string | null;
  stats: EngineStats | null;
  /** The engine shows the Live and Back Screens in its own windows (Windows). */
  nativeOutputs: boolean;
}

export interface EngineHealth {
  id: string;
  state: 'starting' | 'live' | 'noSignal' | 'failed';
  detail: string | null;
  frames: number;
}

// ---- which engine (shared by every part of this window) ----

let info: EngineInfo | null = null;
const listeners = new Set<() => void>();
function set(i: EngineInfo | null) {
  info = i;
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

let started = false;
/** Ask once which engine runs, and follow changes from any window. */
function start() {
  if (started || !isInsideLumora()) return;
  started = true;
  void invoke<EngineInfo>('live_engine_info').then(set, () => {});
  void listen<EngineInfo>('live-engine-changed', (e) => set(e.payload)).catch(() => {});
}

/** The unified engine is chosen and running (so cameras come from it). */
export function unifiedOn(): boolean {
  start();
  return !!info && info.mode === 'unified' && info.running;
}

/** {@link unifiedOn}, following changes. */
export function useUnifiedOn(): boolean {
  start();
  return useSyncExternalStore(subscribe, unifiedOn);
}

/** What the Engine settings show (null until known, and outside Lumora). */
export function useEngineInfo(): EngineInfo | null {
  start();
  return useSyncExternalStore(subscribe, () => info);
}

/** Re-read the engine's status (its statistics change every second). */
export async function refreshEngineInfo(): Promise<EngineInfo | null> {
  if (!isInsideLumora()) return null;
  const i = await invoke<EngineInfo>('live_engine_info');
  set(i);
  return i;
}

export async function setEngineMode(mode: EngineMode): Promise<EngineInfo> {
  const i = await invoke<EngineInfo>('live_engine_set_mode', { mode });
  set(i);
  return i;
}

/** Ten seconds of the Live Screen through the engine's encoder feed into the recordings folder. */
export function testEngineRecording(seconds = 10): Promise<string> {
  return invoke<string>('live_engine_test_record', { seconds });
}

// ---- recording and streaming from the engine ----

export interface EngineCaptureRequest {
  kind: SessionKind;
  name: string;
  rehearse: boolean;
  width: number;
  height: number;
  fps: number;
  vertical: boolean;
  /** `master`: the Stream mix; `b`: the Recording mix. */
  mix: 'master' | 'b';
  sampleRate: number;
  iso: boolean;
  isoSkip: string[];
  isoKbps: number | null;
}

export interface EngineIsoFile {
  id: number;
  sourceId: string;
  name: string;
  path: string;
}

/** Start a recording or stream the engine encodes (with each camera's ISO file from the engine's frames). */
export function engineCaptureStart(request: EngineCaptureRequest): Promise<{ running: CaptureRunning; isos: EngineIsoFile[] }> {
  return invoke<{ running: CaptureRunning; isos: EngineIsoFile[] }>('live_engine_capture_start', { request }).catch((e: unknown) => {
    throw new Error(String(e));
  });
}

/** Stop it; resolves once the last of it is written. */
export function engineCaptureStop(session: number): Promise<void> {
  return invoke('live_engine_capture_stop', { session });
}

/** A piece of a mix's sound for the engine's encoders. */
export function sendEngineSound(mix: 'master' | 'b', pcm: Uint8Array, atMs: number, rate: number): Promise<void> {
  return invoke('live_engine_audio', pcm, { headers: { mix, at: String(atMs), rate: String(rate) } });
}

/** The engine's own encoder stopped by itself (the session is started again, as for the WebView's). */
export function onEngineFeedLost(cb: (kind: SessionKind, session: number, message: string) => void): () => void {
  if (!isInsideLumora()) return () => {};
  let stop: (() => void) | null = null;
  let gone = false;
  void listen<{ kind: SessionKind; session: number; message: string }>('live-engine-feed-lost', (e) =>
    cb(e.payload.kind, e.payload.session, e.payload.message),
  ).then(
    (u) => (gone ? u() : (stop = u)),
    () => {},
  );
  return () => {
    gone = true;
    stop?.();
  };
}

/** Why the test event can't run now (null: it can). */
export function unifiedBlocksTestEvent(): string | null {
  start();
  return info && info.mode === 'unified' && !info.running
    ? `The unified engine is chosen but not running${info.error ? ` (${info.error})` : ''}. Switch to Standard in Settings → Engine, or start Lumora again, to run the test event.`
    : null;
}

// ---- previews: one request loop per tile, shared by every view of it ----

/** How often a visible preview is refreshed. */
const PREVIEW_MS = 100;

interface Feed {
  url: string | null;
  users: Set<(url: string | null) => void>;
  timer: ReturnType<typeof setTimeout> | null;
  busy: boolean;
}
const feeds = new Map<string, Feed>();

function pump(key: string) {
  const f = feeds.get(key);
  if (!f || f.users.size === 0) return;
  f.timer = setTimeout(() => pump(key), PREVIEW_MS);
  if (f.busy || (typeof document !== 'undefined' && document.hidden)) return;
  f.busy = true;
  invoke<ArrayBuffer>('live_engine_preview', { key })
    .then((buf) => {
      if (!buf || buf.byteLength === 0) return;
      const url = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
      const old = f.url;
      f.url = url;
      for (const u of f.users) u(url);
      // The old picture goes once every view has the new one.
      if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
    })
    .catch(() => {})
    .finally(() => {
      f.busy = false;
    });
}

/** Follow a preview tile (`source/<id>`, `program/live`, `next/back`); returns a stop function. */
export function followPreview(key: string, onUrl: (url: string | null) => void): () => void {
  let f = feeds.get(key);
  if (!f) {
    f = { url: null, users: new Set(), timer: null, busy: false };
    feeds.set(key, f);
  }
  f.users.add(onUrl);
  if (f.url) onUrl(f.url);
  if (f.users.size === 1) pump(key);
  const feed = f;
  return () => {
    feed.users.delete(onUrl);
    if (feed.users.size === 0) {
      if (feed.timer) clearTimeout(feed.timer);
      feed.timer = null;
      if (feed.url) URL.revokeObjectURL(feed.url);
      feeds.delete(key);
    }
  };
}

/** The newest picture of a preview tile, as an image address (null until the first arrives). */
export function useEnginePreview(key: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    return followPreview(key, setUrl);
  }, [key]);
  return url;
}

// ---- input health for the backup lineup ----

const ENGINE = Symbol('unified-engine');

/** Turn the engine's reports into this window's input health. Pure, so it can be tested. */
export class EngineHealthWatch {
  private stops = new Map<string, () => void>();
  private frames = new Map<string, number>();

  constructor(private readonly health: InputHealth = inputHealth) {}

  update(rows: EngineHealth[]): void {
    const seen = new Set<string>();
    for (const r of rows) {
      seen.add(r.id);
      if (!this.stops.has(r.id)) this.stops.set(r.id, this.health.watch(r.id));
      const before = this.frames.get(r.id);
      // Before the first frame the input gets its usual grace time (InputHealth's FIRST_FRAME_MS).
      if (r.frames > (before ?? 0)) this.health.frame(r.id);
      this.frames.set(r.id, r.frames);
      this.health.report(r.id, ENGINE, r.state === 'failed' ? (r.detail ?? 'The input stopped') : r.state === 'noSignal' ? 'No picture coming in' : null);
    }
    for (const [id, stop] of this.stops) {
      if (seen.has(id)) continue;
      stop();
      this.health.report(id, ENGINE, null);
      this.stops.delete(id);
      this.frames.delete(id);
    }
  }

  stop(): void {
    this.update([]);
  }
}

/** While the unified engine runs, keep the backup lineup's watch fed from it (control window). */
export function watchEngineHealth(everyMs = 500): () => void {
  if (!isInsideLumora()) return () => {};
  const watch = new EngineHealthWatch();
  let alive = true;
  const tick = async () => {
    if (!alive) return;
    try {
      watch.update(unifiedOn() ? await invoke<EngineHealth[]>('live_engine_health') : []);
    } catch {
      // The engine is switching; try again next time.
    }
  };
  const id = setInterval(() => void tick(), everyMs);
  return () => {
    alive = false;
    clearInterval(id);
    watch.stop();
  };
}
