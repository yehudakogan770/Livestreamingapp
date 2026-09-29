// Talks to the Lumora engine.
//
// Inside the Lumora app this goes through Tauri to the Rust engine. When the
// UI is opened in a plain browser (design work, UI tests), a demo engine that
// follows the same rules is used so every screen can be tried out.

import { whileCopying } from './copying';
import { defaultVisuals } from './visuals';
import type { Action } from './types/Action';
import type { ActionError } from './types/ActionError';
import type { ScreenId } from './types/ScreenId';
import type { Show } from './types/Show';
import type { Countdown } from './types/Countdown';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { demoApply, demoTick } from './demo';
import { channels } from './overlays';
import { emptyRun } from './cues';
import type { LibraryItem } from './library';

/**
 * Lumora keeps its own copy of every imported file, so the event still works
 * when the original is moved or deleted. Resolves the copy's path.
 */
async function keep(path: string): Promise<string> {
  try {
    return await whileCopying(baseName(path), () => invoke<string>('keep_media', { path }));
  } catch (e) {
    throw new Error(String(e));
  }
}

export interface ShowSnapshot {
  revision: number;
  show: Show;
}

/** A display connected to the computer (from the Rust side). */
export interface Display {
  id: string;
  width: number;
  height: number;
  x: number;
  y: number;
  primary: boolean;
}

export type MediaKind = 'video' | 'image' | 'audio' | 'pdf';

/** The open event's file and the recent list. */
export interface EventFiles {
  current: string | null;
  recent: string[];
}

/** The phone and tablet remote (from the Rust side). */
export interface RemoteStatus {
  enabled: boolean;
  /** Listening right now. */
  running: boolean;
  pin: string;
  port: number | null;
  /** Addresses phones can open, each with a QR code (SVG). */
  addresses: { url: string; qr: string }[];
  /** Phones connected now. */
  phones: number;
  /** Why it could not start. */
  error: string | null;
}

// ----- recording and streaming (mirrors src-tauri/src/capture.rs) -----

export type CaptureKind = 'record' | 'stream';
export type Quality = '720p' | '1080p' | '1080p60';

/** Where the stream goes. */
export interface Destination {
  id: string;
  name: string;
  /** The server, e.g. rtmp://a.rtmp.youtube.com/live2 */
  url: string;
  key: string;
  enabled: boolean;
}

export interface CaptureSettings {
  /** Where recordings go (null: the Videos folder). */
  folder: string | null;
  quality: Quality;
  videoKbps: number;
  /** Which mix a recording hears: the same as the stream, or mix B. */
  recordMix: 'stream' | 'recording';
  destinations: Destination[];
}

export interface CaptureRunning {
  session: number;
  startedAt: number;
  path: string | null;
  destinations: string[];
  bytes: number;
  /** How fast FFmpeg keeps up (1 = real time). */
  speed: number | null;
}

export interface CaptureStatus {
  /** FFmpeg was found (needed for streaming and for .mp4 files). */
  ffmpeg: boolean;
  recording: CaptureRunning | null;
  streaming: CaptureRunning | null;
  lastRecording: string | null;
  /** Still turning the last recording into an .mp4. */
  finishing: boolean;
  failure: { kind: CaptureKind; session: number; message: string } | null;
}

export function defaultCaptureSettings(): CaptureSettings {
  return { folder: null, quality: '1080p', videoKbps: 6000, recordMix: 'stream', destinations: [] };
}

export interface EngineClient {
  /** True when connected to the real engine. */
  readonly live: boolean;
  getShow(): Promise<ShowSnapshot>;
  /** Resolves when applied; rejects with an {@link EngineError} if refused. */
  dispatch(action: Action): Promise<void>;
  /** Called with every new version of the show. Returns an unsubscribe function. */
  subscribe(onChange: (snapshot: ShowSnapshot) => void): () => void;

  // ----- output windows -----
  listDisplays(): Promise<Display[]>;
  openOutput(screen: ScreenId): Promise<void>;
  closeOutput(screen: ScreenId): Promise<void>;
  /** Called with the screens whose output window is open, now and on every change. */
  watchOutputs(onChange: (open: ScreenId[]) => void): () => void;

  // ----- event files -----
  eventFiles(): Promise<EventFiles>;
  watchEventFiles(onChange: (f: EventFiles) => void): () => void;
  newEvent(): Promise<void>;
  /** Open an event file (asks which one when no path is given). Resolves false if cancelled. */
  openEvent(path?: string): Promise<boolean>;
  /** Save the event to a file the operator chooses. Resolves the path, or null if cancelled. */
  saveEventAs(): Promise<string | null>;

  // ----- phone remote -----
  /** Called with the remote's status, now and on every change. */
  watchRemote(onChange: (s: RemoteStatus) => void): () => void;
  setRemote(on: boolean): Promise<RemoteStatus>;
  /** A new PIN; connected phones have to type it again. */
  newRemotePin(): Promise<RemoteStatus>;

  // ----- recording and streaming -----
  /** Called with the recording/streaming status, now and on every change. */
  watchCapture(onChange: (s: CaptureStatus) => void): () => void;
  captureSettings(): Promise<CaptureSettings>;
  setCaptureSettings(s: CaptureSettings): Promise<CaptureSettings>;
  /** The folder recordings go to. */
  captureFolder(): Promise<string>;
  /** Ask the operator for a folder. Resolves null if cancelled. */
  pickFolder(): Promise<string | null>;
  /** Start a recording or stream of what the encoder makes (`mime`); `name` names the file. */
  captureStart(kind: CaptureKind, mime: string, name: string): Promise<CaptureRunning>;
  /** More encoded picture and sound, in order. */
  captureChunk(session: number, data: ArrayBuffer): Promise<void>;
  captureStop(session: number): Promise<void>;

  // ----- files -----
  /** Ask the operator for a video or picture file. Resolves to its path, or null if cancelled. */
  pickFile(kind: MediaKind): Promise<{ path: string; name: string } | null>;
  /** Ask for several files at once (e.g. slides). Resolves [] if cancelled. */
  pickFiles(kind: MediaKind): Promise<{ path: string; name: string }[]>;
  /** A URL the page can load a file path from. */
  mediaUrl(path: string): string;
  /** Keep a picture made here (a PDF page) with the app's files; resolves its path. */
  saveSlide(png: Blob, name: string): Promise<string>;

  // ----- library (kept on this computer) -----
  libraryItems(): Promise<LibraryItem[]>;
  saveLibrary(items: LibraryItem[]): Promise<void>;
  /** Save items to a file the operator chooses (to take to another computer). Resolves false if cancelled. */
  exportLibrary(items: LibraryItem[]): Promise<boolean>;
  /** Read items from a file the operator chooses. Resolves [] if cancelled. */
  importLibrary(): Promise<LibraryItem[]>;
}

/** An action the engine refused, with the engine's reason. */
export class EngineError extends Error {
  constructor(readonly detail: ActionError | { code: 'unavailable' }) {
    super(describe(detail));
    this.name = 'EngineError';
  }
}

function describe(detail: ActionError | { code: 'unavailable' }): string {
  switch (detail.code) {
    case 'unknownSource':
      return `There is no source "${detail.id}".`;
    case 'duplicateSource':
      return `A source "${detail.id}" already exists.`;
    case 'notAVideo':
      return `"${detail.id}" is not a video.`;
    case 'nothingInPreview':
      return 'Nothing is lined up in preview yet.';
    case 'monitorIsTextOnly':
      return 'The Monitor shows text only.';
    case 'soundOnly':
      return 'That input is sound only (like a microphone), so it can’t go on a screen.';
    case 'invalidValue':
      return `${detail.field}: ${detail.reason}`;
    case 'unavailable':
      return 'Not available in the browser demo. Open Lumora itself for this.';
  }
}

/** A countdown timer with the standard settings (mirrors Countdown::default). */
export function defaultCountdown(): Countdown {
  return {
    lengthMs: 300_000,
    endsAt: null,
    remainingMs: 300_000,
    label: 'Starting soon',
    endText: 'Welcome!',
    format: 'auto',
    atZero: { type: 'hide' },
    fired: false,
  };
}

export function emptyShow(): Show {
  const screen = {
    preview: null,
    program: null,
    previous: null,
    transition: null,
    tbar: 0,
    blank: false,
    blankChangedAt: 0,
    flashAt: 0,
  };
  return {
    version: 2,
    sources: [],
    screens: { live: { ...screen }, back: { ...screen }, monitor: { ...screen } },
    transition: { kind: 'fade', durationMs: 800 },
    panic: false,
    panicChangedAt: 0,
    masterVolume: 1,
    backFollowsLive: false,
    event: { name: '', logo: null, onFailure: 'black', panicShows: 'black', setUp: false },
    presets: [],
    activePreset: null,
    running: [],
    audio: {
      masterMuted: false,
      a: { name: 'Hall', volume: 1, muted: false },
      b: { name: 'Recording', volume: 1, muted: false },
      solo: null,
    },
    monitor: {
      message: '',
      messageOn: false,
      layout: 'full',
      showClock: true,
      showTimer: true,
      textSize: 'l',
      clock24h: false,
      quick: ['Please wrap up', '5 minutes left', '2 minutes left', 'Speak louder', 'Look at camera 2', 'Next: video', 'Stand by', 'Thank you!'],
    },
    run: emptyRun(),
    overlays: channels(),
    visuals: defaultVisuals(),
    settings: {
      displays: { live: null, back: null, monitor: null },
      autoPlayOnTake: true,
      audioOutputs: { master: null, a: null, b: null, headphones: null },
    },
  };
}

export function isInsideLumora(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const FILTERS: Record<MediaKind, { name: string; extensions: string[] }> = {
  video: { name: 'Videos', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'mpg', 'mpeg'] },
  image: { name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
  audio: { name: 'Sound and music', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma', 'opus'] },
  pdf: { name: 'PDF (save PowerPoint as PDF first)', extensions: ['pdf'] },
};

/** A "video" source that is really a sound file (music, effects): heard, never shown. */
export function isSoundFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return FILTERS.audio.extensions.includes(ext);
}

/** The file name without folders or extension, for a default input name. */
export function baseName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

class TauriClient implements EngineClient {
  readonly live = true;

  listDisplays(): Promise<Display[]> {
    return invoke<Display[]>('list_displays');
  }

  async openOutput(screen: ScreenId): Promise<void> {
    await invoke('open_output', { screen });
  }

  async closeOutput(screen: ScreenId): Promise<void> {
    await invoke('close_output', { screen });
  }

  watchOutputs(onChange: (open: ScreenId[]) => void): () => void {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void invoke<ScreenId[]>('open_outputs').then((o) => !cancelled && onChange(o));
    void listen<ScreenId[]>('outputs-changed', (e) => onChange(e.payload)).then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }

  eventFiles(): Promise<EventFiles> {
    return invoke<EventFiles>('event_files');
  }

  watchEventFiles(onChange: (f: EventFiles) => void): () => void {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void this.eventFiles().then((f) => !cancelled && onChange(f));
    void listen<EventFiles>('event-files-changed', (e) => onChange(e.payload)).then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }

  async newEvent(): Promise<void> {
    await invoke('new_event');
  }

  async openEvent(path?: string): Promise<boolean> {
    let p = path;
    if (!p) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const chosen = await open({ multiple: false, directory: false, filters: [{ name: 'Lumora events', extensions: ['lumora'] }] });
      if (typeof chosen !== 'string') return false;
      p = chosen;
    }
    try {
      await invoke('open_event', { path: p });
      return true;
    } catch (e) {
      throw new Error(String(e));
    }
  }

  async saveEventAs(): Promise<string | null> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ filters: [{ name: 'Lumora events', extensions: ['lumora'] }], defaultPath: 'Event.lumora' });
    if (!path) return null;
    try {
      return await invoke<string>('save_event_as', { path });
    } catch (e) {
      throw new Error(String(e));
    }
  }

  watchRemote(onChange: (s: RemoteStatus) => void): () => void {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void invoke<RemoteStatus>('remote_status').then((s) => !cancelled && onChange(s));
    void listen<RemoteStatus>('remote-changed', (e) => onChange(e.payload)).then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }

  setRemote(on: boolean): Promise<RemoteStatus> {
    return invoke<RemoteStatus>('set_remote', { on });
  }

  newRemotePin(): Promise<RemoteStatus> {
    return invoke<RemoteStatus>('new_remote_pin');
  }

  watchCapture(onChange: (s: CaptureStatus) => void): () => void {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void invoke<CaptureStatus>('capture_status').then((s) => !cancelled && onChange(s));
    void listen<CaptureStatus>('capture-changed', (e) => onChange(e.payload)).then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }

  captureSettings(): Promise<CaptureSettings> {
    return invoke<CaptureSettings>('capture_settings');
  }

  setCaptureSettings(settings: CaptureSettings): Promise<CaptureSettings> {
    return invoke<CaptureSettings>('set_capture_settings', { settings });
  }

  captureFolder(): Promise<string> {
    return invoke<string>('capture_folder');
  }

  async pickFolder(): Promise<string | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({ multiple: false, directory: true });
    return typeof path === 'string' ? path : null;
  }

  async captureStart(kind: CaptureKind, mime: string, name: string): Promise<CaptureRunning> {
    try {
      return await invoke<CaptureRunning>('capture_start', { kind, mime, name });
    } catch (e) {
      throw new Error(String(e));
    }
  }

  async captureChunk(session: number, data: ArrayBuffer): Promise<void> {
    await invoke('capture_chunk', new Uint8Array(data), { headers: { session: String(session) } });
  }

  async captureStop(session: number): Promise<void> {
    await invoke('capture_stop', { session });
  }

  async pickFile(kind: MediaKind): Promise<{ path: string; name: string } | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({ multiple: false, directory: false, filters: [FILTERS[kind]] });
    return typeof path === 'string' ? { path: await keep(path), name: baseName(path) } : null;
  }

  mediaUrl(path: string): string {
    if (/^(blob:|data:|https?:)/.test(path)) return path;
    return convertFileSrc(path);
  }

  async pickFiles(kind: MediaKind): Promise<{ path: string; name: string }[]> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const paths = await open({ multiple: true, directory: false, filters: [FILTERS[kind]] });
    const picked = Array.isArray(paths) ? paths : paths ? [paths] : [];
    const out: { path: string; name: string }[] = [];
    for (const path of picked) out.push({ path: await keep(path), name: baseName(path) });
    return out;
  }

  async saveSlide(png: Blob, name: string): Promise<string> {
    return invoke<string>('save_slide', new Uint8Array(await png.arrayBuffer()), { headers: { name } });
  }

  async libraryItems(): Promise<LibraryItem[]> {
    return invoke<LibraryItem[]>('library_items');
  }

  async saveLibrary(items: LibraryItem[]): Promise<void> {
    try {
      await invoke('save_library', { items });
    } catch (e) {
      throw new Error(String(e));
    }
  }

  async exportLibrary(items: LibraryItem[]): Promise<boolean> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ filters: [{ name: 'Lumora library', extensions: ['lumora-library'] }], defaultPath: 'Lumora library.lumora-library' });
    if (!path) return false;
    try {
      await invoke('export_library', { path, items });
      return true;
    } catch (e) {
      throw new Error(String(e));
    }
  }

  async importLibrary(): Promise<LibraryItem[]> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({ multiple: false, directory: false, filters: [{ name: 'Lumora library', extensions: ['lumora-library', 'json'] }] });
    if (typeof path !== 'string') return [];
    try {
      return await invoke<LibraryItem[]>('import_library', { path });
    } catch (e) {
      throw new Error(String(e));
    }
  }

  async getShow(): Promise<ShowSnapshot> {
    return invoke<ShowSnapshot>('get_show');
  }

  async dispatch(action: Action): Promise<void> {
    try {
      await invoke('dispatch', { action });
    } catch (err) {
      throw new EngineError(err as ActionError);
    }
  }

  subscribe(onChange: (snapshot: ShowSnapshot) => void): () => void {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void listen<ShowSnapshot>('show-changed', (e) => onChange(e.payload)).then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }
}

/** Browser stand-in: keeps a show in memory and applies actions with the demo engine. */
export class DemoClient implements EngineClient {
  readonly live = false;
  private snapshot: ShowSnapshot;
  private listeners = new Set<(s: ShowSnapshot) => void>();

  constructor(show: Show = emptyShow()) {
    this.snapshot = { revision: 0, show };
    // The demo's heartbeat, like the engine's: runs anything due (countdown at zero).
    if (typeof window !== 'undefined') {
      setInterval(() => {
        const next = demoTick(this.snapshot.show, Date.now());
        if (next) this.publish(next);
      }, 100);
    }
  }

  private publish(show: Show) {
    this.snapshot = { revision: this.snapshot.revision + 1, show };
    for (const l of this.listeners) l(this.snapshot);
  }

  getShow(): Promise<ShowSnapshot> {
    return Promise.resolve(this.snapshot);
  }

  dispatch(action: Action): Promise<void> {
    try {
      const show = demoApply(this.snapshot.show, action, Date.now());
      if (JSON.stringify(show) !== JSON.stringify(this.snapshot.show)) this.publish(show);
      return Promise.resolve();
    } catch (detail) {
      return Promise.reject(new EngineError(detail as ActionError));
    }
  }

  subscribe(onChange: (snapshot: ShowSnapshot) => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  listDisplays(): Promise<Display[]> {
    return Promise.resolve([{ id: 'This screen', width: window.screen.width, height: window.screen.height, x: 0, y: 0, primary: true }]);
  }

  openOutput(): Promise<void> {
    return Promise.reject(new EngineError({ code: 'unavailable' }));
  }

  closeOutput(): Promise<void> {
    return Promise.resolve();
  }

  watchOutputs(onChange: (open: ScreenId[]) => void): () => void {
    onChange([]);
    return () => {};
  }

  eventFiles(): Promise<EventFiles> {
    return Promise.resolve({ current: null, recent: [] });
  }

  watchEventFiles(onChange: (f: EventFiles) => void): () => void {
    onChange({ current: null, recent: [] });
    return () => {};
  }

  newEvent(): Promise<void> {
    this.publish({ ...emptyShow(), settings: this.snapshot.show.settings });
    return Promise.resolve();
  }

  openEvent(): Promise<boolean> {
    return Promise.reject(new EngineError({ code: 'unavailable' }));
  }

  saveEventAs(): Promise<string | null> {
    return Promise.reject(new EngineError({ code: 'unavailable' }));
  }

  watchRemote(onChange: (s: RemoteStatus) => void): () => void {
    onChange({ enabled: false, running: false, pin: '', port: null, addresses: [], phones: 0, error: null });
    return () => {};
  }

  setRemote(): Promise<RemoteStatus> {
    return Promise.reject(new EngineError({ code: 'unavailable' }));
  }

  newRemotePin(): Promise<RemoteStatus> {
    return Promise.reject(new EngineError({ code: 'unavailable' }));
  }

  // Recording in the browser demo keeps the file in memory and offers it as a
  // download; streaming needs the Lumora app.
  private capture: CaptureStatus = { ffmpeg: false, recording: null, streaming: null, lastRecording: null, finishing: false, failure: null };
  private captureWatchers = new Set<(s: CaptureStatus) => void>();
  private captureSet = defaultCaptureSettings();
  private recorded: { session: number; mime: string; name: string; parts: ArrayBuffer[] } | null = null;
  private nextSession = 1;

  private captureChanged(patch: Partial<CaptureStatus>) {
    this.capture = { ...this.capture, ...patch };
    for (const w of this.captureWatchers) w(this.capture);
  }

  watchCapture(onChange: (s: CaptureStatus) => void): () => void {
    this.captureWatchers.add(onChange);
    onChange(this.capture);
    return () => this.captureWatchers.delete(onChange);
  }

  captureSettings(): Promise<CaptureSettings> {
    return Promise.resolve(this.captureSet);
  }

  setCaptureSettings(s: CaptureSettings): Promise<CaptureSettings> {
    this.captureSet = s;
    return Promise.resolve(s);
  }

  captureFolder(): Promise<string> {
    return Promise.resolve('Downloads (browser demo)');
  }

  pickFolder(): Promise<string | null> {
    return Promise.reject(new EngineError({ code: 'unavailable' }));
  }

  captureStart(kind: CaptureKind, mime: string, name: string): Promise<CaptureRunning> {
    if (kind === 'stream') return Promise.reject(new Error('Streaming needs the Lumora app; the browser demo can only record.'));
    if (this.capture.recording) return Promise.reject(new Error('Already recording.'));
    const session = this.nextSession++;
    this.recorded = { session, mime, name, parts: [] };
    const running: CaptureRunning = { session, startedAt: Date.now(), path: `${name}.webm`, destinations: [], bytes: 0, speed: null };
    this.captureChanged({ recording: running, failure: null });
    return Promise.resolve(running);
  }

  captureChunk(session: number, data: ArrayBuffer): Promise<void> {
    const r = this.recorded;
    if (!r || r.session !== session) return Promise.reject(new Error('not running'));
    r.parts.push(data);
    const bytes = r.parts.reduce((n, p) => n + p.byteLength, 0);
    if (this.capture.recording) this.captureChanged({ recording: { ...this.capture.recording, bytes } });
    return Promise.resolve();
  }

  captureStop(session: number): Promise<void> {
    const r = this.recorded;
    if (!r || r.session !== session) return Promise.resolve();
    this.recorded = null;
    const url = URL.createObjectURL(new Blob(r.parts, { type: r.mime }));
    this.captureChanged({ recording: null, lastRecording: url });
    return Promise.resolve();
  }

  pickFile(kind: MediaKind): Promise<{ path: string; name: string } | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = FILTERS[kind].extensions.map((e) => '.' + e).join(',');
      input.onchange = () => {
        const f = input.files?.[0];
        // Keep the file name after # so the kind of file (e.g. .mp3) is still known.
        resolve(f ? { path: `${URL.createObjectURL(f)}#${f.name}`, name: baseName(f.name) } : null);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  mediaUrl(path: string): string {
    return path;
  }

  pickFiles(kind: MediaKind): Promise<{ path: string; name: string }[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = FILTERS[kind].extensions.map((e) => '.' + e).join(',');
      input.onchange = () => resolve([...(input.files ?? [])].map((f) => ({ path: `${URL.createObjectURL(f)}#${f.name}`, name: baseName(f.name) })));
      input.oncancel = () => resolve([]);
      input.click();
    });
  }

  saveSlide(png: Blob, name: string): Promise<string> {
    return Promise.resolve(`${URL.createObjectURL(png)}#${name}`);
  }

  // The demo keeps its library in this browser.
  libraryItems(): Promise<LibraryItem[]> {
    try {
      return Promise.resolve(JSON.parse(localStorage.getItem('lumora.library') ?? '[]') as LibraryItem[]);
    } catch {
      return Promise.resolve([]);
    }
  }

  saveLibrary(items: LibraryItem[]): Promise<void> {
    try {
      localStorage.setItem('lumora.library', JSON.stringify(items));
    } catch {
      /* private browsing: kept until the page closes */
    }
    return Promise.resolve();
  }

  exportLibrary(items: LibraryItem[]): Promise<boolean> {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ lumoraLibrary: 1, items }, null, 2)], { type: 'application/json' }));
    a.download = 'Lumora library.lumora-library';
    a.click();
    return Promise.resolve(true);
  }

  importLibrary(): Promise<LibraryItem[]> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.lumora-library,.json';
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) return resolve([]);
        void f.text().then((t) => {
          try {
            const v = JSON.parse(t) as { items?: LibraryItem[] } | LibraryItem[];
            const items = Array.isArray(v) ? v : v.items;
            if (!Array.isArray(items)) throw new Error('That file is not a Lumora library.');
            resolve(items);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      };
      input.oncancel = () => resolve([]);
      input.click();
    });
  }
}

export function createEngineClient(): EngineClient {
  return isInsideLumora() ? new TauriClient() : new DemoClient();
}
