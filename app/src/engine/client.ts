import type { Ptz } from './types/Ptz';
import { defaultPlace } from './zmanim';
import { defaultBrand } from './brand';
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

export type MediaKind = 'video' | 'image' | 'audio' | 'pdf' | 'font';

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
  addresses: { url: string; qr: string; voteUrl: string; voteQr: string }[];
  /** Phones connected now. */
  phones: number;
  /** Why it could not start. */
  error: string | null;
  /** The audience page on the internet, for phones on any network. */
  internet: {
    on: boolean;
    phase: 'off' | 'getting' | 'starting' | 'on' | 'retrying';
    voteUrl: string | null;
    voteQr: string | null;
    error: string | null;
  };
}

// ----- recording and streaming (mirrors src-tauri/src/capture.rs) -----

export type CaptureKind = 'record' | 'stream';

/** What to make a PTZ camera do (mirrors src-tauri/src/ptz.rs). */
export type PtzCommand =
  | { type: 'move'; pan: number; tilt: number; speed: number }
  | { type: 'stop' }
  | { type: 'zoom'; dir: -1 | 0 | 1; speed: number }
  | { type: 'home' }
  | { type: 'recall'; preset: number }
  | { type: 'store'; preset: number }
  | { type: 'autoFocus' };

/** How hard the computer is working (mirrors src-tauri/src/perf.rs). */
export interface PerfStats {
  cpu: number;
  memUsedMb: number;
  memTotalMb: number;
  appMemMb: number;
  /** The graphics card's 3D use, 0 – 100 (null where it can't be measured). */
  gpu: number | null;
}

/** A display or window this computer can capture. */
export interface CaptureChoice {
  kind: 'display' | 'window';
  index: number;
  name: string;
  app: string;
}
export type Quality = '720p' | '720p60' | '1080p' | '1080p60' | '1440p' | '1440p60' | '2160p' | 'vertical';

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
  /** Sound bitrate, kbit/s. */
  audioKbps: number;
  /** Which mix a recording hears: the same as the stream, or mix B. */
  recordMix: 'stream' | 'recording';
  /** Also record each camera to its own file. */
  iso: boolean;
  /** Save a chapter list with each recording. */
  chapters: boolean;
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
  return { folder: null, quality: '1080p', videoKbps: 6000, audioKbps: 160, recordMix: 'stream', iso: false, chapters: true, destinations: [] };
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
  /** The multiview window (every input and the screens, for the crew). */
  openMultiview(): Promise<void>;
  closeMultiview(): Promise<void>;
  multiviewOpen(): Promise<boolean>;
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
  /** Choose a data file (CSV or JSON) where it is: it is read again as it changes. Null if cancelled. */
  pickDataFile(): Promise<string | null>;
  /** Read the data file's text. */
  readDataFile(path: string): Promise<string>;
  /** Put the audience page on the internet (or take it off). */
  setAudienceInternet(on: boolean): Promise<RemoteStatus>;
  /** A QR code (SVG) for this text. */
  qrCode(text: string): Promise<string>;

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
  /** Keep a snapshot picture (in the Snapshots folder next to the recordings); resolves where. */
  saveSnapshot(png: Blob, name: string): Promise<string>;
  /** Start a camera's own file next to the recording (null where that isn't possible). */
  isoStart(recording: string, camera: string, ext: 'mkv' | 'webm'): Promise<number | null>;
  isoChunk(id: number, bytes: ArrayBuffer): Promise<void>;
  isoStop(id: number): Promise<void>;
  /** Save the chapter list next to the recording (null where that isn't possible). */
  saveChapters(recording: string, text: string): Promise<string | null>;
  /** How hard the computer is working (null where it can't be measured). */
  perfStats(): Promise<PerfStats | null>;
  /** Keep a replay piece with the app's files; resolves its path. */
  saveReplay(video: Blob, name: string): Promise<string>;

  // ----- library (kept on this computer) -----
  libraryItems(): Promise<LibraryItem[]>;
  saveLibrary(items: LibraryItem[]): Promise<void>;
  /** Save items to a file the operator chooses (to take to another computer). Resolves false if cancelled. */
  exportLibrary(items: LibraryItem[]): Promise<boolean>;
  /** Read items from a file the operator chooses. Resolves [] if cancelled. */
  importLibrary(): Promise<LibraryItem[]>;

  // ----- video export (the 3D logo maker) -----
  /** Ask where to save a video. Resolves null if cancelled. */
  chooseVideoFile(name: string, format: VideoFormat): Promise<string | null>;
  exportStart(settings: { path: string; width: number; height: number; fps: number; format: VideoFormat }): Promise<number>;
  /** One frame of raw RGBA pixels. */
  exportFrame(session: number, rgba: Uint8ClampedArray): Promise<void>;
  /** Resolves the finished file's path. */
  exportFinish(session: number): Promise<string>;
  exportCancel(session: number): Promise<void>;

  // ----- web pages -----
  /** Where web page frames are served; `captured` false: show pages directly. */
  browserInfo(): Promise<{ port: number | null; captured: boolean }>;
  /** Bring a web page's window to the front to click on it (or send it back). */
  browserPage(id: string, front: boolean): Promise<void>;
  browserNav(id: string, how: 'back' | 'forward' | 'reload'): Promise<void>;
  /** How each stream input is doing. */
  streamStatus(): Promise<Record<string, { live: boolean; problem: string | null }>>;
  /** Move, zoom or recall a PTZ camera. */
  ptz(ptz: Ptz, command: PtzCommand): Promise<void>;
  /** Displays and windows a screen capture input can show (none outside the Windows app). */
  captureChoices(): Promise<CaptureChoice[]>;
}

export type VideoFormat = 'mp4' | 'mov' | 'webm';
const VIDEO_NAMES: Record<VideoFormat, string> = { mp4: 'MP4 video', mov: 'MOV video (keeps transparency)', webm: 'WebM video' };

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
    blankFadeMs: 0,
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
    event: {
      name: '',
      logo: null,
      onFailure: 'black',
      panicShows: 'black',
      setUp: false,
      brand: defaultBrand(),
      wifi: { name: '', password: '', qr: '', show: false },
      place: defaultPlace(),
    },
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
      showLyrics: true,
      textSize: 'l',
      clock24h: false,
      quick: ['Please wrap up', '5 minutes left', '2 minutes left', 'Speak louder', 'Look at camera 2', 'Next: video', 'Stand by', 'Thank you!'],
      prompter: { on: false, script: '', speed: 4, size: 8, mirror: false, pos: 0, since: null },
    },
    run: emptyRun(),
    overlays: channels(),
    visuals: defaultVisuals(),
    data: { path: '', everyMs: 1000, headers: [], rows: [], row: 0, error: '', updatedAt: 0 },
    autoSwitch: { on: false, cameras: [], minS: 6, maxS: 10, random: false, mix: false, nextAt: 0, seed: 1 },
    qna: { open: false, questions: [], nextId: 0 },
    triggers: [],
    settings: {
      displays: { live: null, back: null, monitor: null },
      autoPlayOnTake: true,
      audioOutputs: { master: null, a: null, b: null, headphones: null },
      fadeToBlackMs: 2000,
      multiview: { display: null, layout: 'classic' },
      stingers: [
        { path: '', durationMs: 0, cutMs: 0 },
        { path: '', durationMs: 0, cutMs: 0 },
      ],
      favouriteTransitions: [
        { kind: 'fade', durationMs: 800 },
        { kind: 'dip', durationMs: 1500 },
        { kind: 'wipe', durationMs: 1000 },
        { kind: 'slide', durationMs: 600 },
      ],
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
  font: { name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] },
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

  async openMultiview(): Promise<void> {
    await invoke('open_multiview');
  }

  async closeMultiview(): Promise<void> {
    await invoke('close_multiview');
  }

  multiviewOpen(): Promise<boolean> {
    return invoke<boolean>('multiview_open');
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

  setAudienceInternet(on: boolean): Promise<RemoteStatus> {
    return invoke<RemoteStatus>('set_audience_internet', { on });
  }

  async pickDataFile(): Promise<string | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({ multiple: false, directory: false, filters: [{ name: 'Spreadsheet (CSV) or JSON', extensions: ['csv', 'json', 'txt'] }] });
    return typeof path === 'string' ? path : null;
  }

  readDataFile(path: string): Promise<string> {
    return invoke<string>('read_data_file', { path });
  }

  qrCode(text: string): Promise<string> {
    return invoke<string>('qr_code', { text });
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

  async saveSnapshot(png: Blob, name: string): Promise<string> {
    try {
      return await invoke<string>('save_snapshot', new Uint8Array(await png.arrayBuffer()), { headers: { name } });
    } catch (e) {
      throw new Error(String(e));
    }
  }

  async isoStart(recording: string, camera: string, ext: 'mkv' | 'webm'): Promise<number | null> {
    const [id] = await invoke<[number, string]>('iso_start', { recording, camera, ext });
    return id;
  }

  isoChunk(id: number, bytes: ArrayBuffer): Promise<void> {
    return invoke('iso_chunk', new Uint8Array(bytes), { headers: { id: String(id) } });
  }

  isoStop(id: number): Promise<void> {
    return invoke('iso_stop', { id });
  }

  saveChapters(recording: string, text: string): Promise<string | null> {
    return invoke<string>('save_chapters', { recording, text });
  }

  perfStats(): Promise<PerfStats | null> {
    return invoke<PerfStats>('perf_stats').catch(() => null);
  }

  async saveReplay(video: Blob, name: string): Promise<string> {
    try {
      return await invoke<string>('save_replay', new Uint8Array(await video.arrayBuffer()), { headers: { name } });
    } catch (e) {
      throw new Error(String(e));
    }
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

  async chooseVideoFile(name: string, format: VideoFormat): Promise<string | null> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    return save({ filters: [{ name: VIDEO_NAMES[format], extensions: [format] }], defaultPath: `${name}.${format}` });
  }

  async exportStart(settings: { path: string; width: number; height: number; fps: number; format: VideoFormat }): Promise<number> {
    try {
      return await invoke<number>('export_start', { settings });
    } catch (e) {
      throw new Error(String(e));
    }
  }

  async exportFrame(session: number, rgba: Uint8ClampedArray): Promise<void> {
    try {
      await invoke('export_frame', new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), { headers: { session: String(session) } });
    } catch (e) {
      throw new Error(String(e));
    }
  }

  async exportFinish(session: number): Promise<string> {
    try {
      return await invoke<string>('export_finish', { session });
    } catch (e) {
      throw new Error(String(e));
    }
  }

  async exportCancel(session: number): Promise<void> {
    await invoke('export_cancel', { session });
  }

  browserInfo(): Promise<{ port: number | null; captured: boolean }> {
    return invoke('browser_info');
  }

  async browserPage(id: string, front: boolean): Promise<void> {
    try {
      await invoke('browser_page', { id, front });
    } catch (e) {
      throw new Error(String(e));
    }
  }

  streamStatus(): Promise<Record<string, { live: boolean; problem: string | null }>> {
    return invoke('stream_status');
  }

  captureChoices(): Promise<CaptureChoice[]> {
    return invoke<CaptureChoice[]>('capture_choices').catch(() => []);
  }

  async ptz(ptz: Ptz, command: PtzCommand): Promise<void> {
    try {
      await invoke('ptz_command', { ptz, command });
    } catch (e) {
      throw new Error(String(e));
    }
  }

  async browserNav(id: string, how: 'back' | 'forward' | 'reload'): Promise<void> {
    try {
      await invoke('browser_nav', { id, how });
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

  openMultiview(): Promise<void> {
    // In a browser the multiview opens in its own tab.
    window.open(`${location.pathname}?output=multiview`, '_blank');
    return Promise.resolve();
  }

  closeMultiview(): Promise<void> {
    return Promise.resolve();
  }

  multiviewOpen(): Promise<boolean> {
    return Promise.resolve(false);
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
    onChange({
      enabled: false,
      running: false,
      pin: '',
      port: null,
      addresses: [],
      phones: 0,
      error: null,
      internet: { on: false, phase: 'off', voteUrl: null, voteQr: null, error: null },
    });
    return () => {};
  }

  setRemote(): Promise<RemoteStatus> {
    return Promise.reject(new EngineError({ code: 'unavailable' }));
  }

  newRemotePin(): Promise<RemoteStatus> {
    return Promise.reject(new EngineError({ code: 'unavailable' }));
  }

  setAudienceInternet(): Promise<RemoteStatus> {
    return Promise.reject(new EngineError({ code: 'unavailable' }));
  }

  /** Files chosen in the browser demo (read once; a browser can't read them again). */
  private dataFiles = new Map<string, string>();

  pickDataFile(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,.json,.txt';
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return resolve(null);
        this.dataFiles.set(f.name, await f.text());
        resolve(f.name);
      };
      input.click();
    });
  }

  readDataFile(path: string): Promise<string> {
    const t = this.dataFiles.get(path);
    return t === undefined ? Promise.reject(new Error('choose the file again (the browser demo cannot read files by itself)')) : Promise.resolve(t);
  }

  /** A stand-in picture (real codes are made by the Lumora app). */
  qrCode(text: string): Promise<string> {
    const label = text.startsWith('WIFI:') ? 'Wi-Fi' : 'QR';
    return Promise.resolve(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/><rect width="4" height="4"/><rect x="6" y="6" width="4" height="4"/><text x="5" y="5.6" font-size="2" text-anchor="middle">${label}</text></svg>`,
    );
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

  isoStart(): Promise<number | null> {
    // A browser can only save the one recording.
    return Promise.resolve(null);
  }

  isoChunk(): Promise<void> {
    return Promise.resolve();
  }

  isoStop(): Promise<void> {
    return Promise.resolve();
  }

  saveChapters(): Promise<string | null> {
    return Promise.resolve(null);
  }

  perfStats(): Promise<PerfStats | null> {
    return Promise.resolve(null);
  }

  saveReplay(video: Blob): Promise<string> {
    // In a browser the replay lives in memory.
    return Promise.resolve(URL.createObjectURL(video));
  }

  saveSnapshot(png: Blob, name: string): Promise<string> {
    // In a browser the picture is downloaded.
    const a = document.createElement('a');
    a.href = URL.createObjectURL(png);
    a.download = name;
    a.click();
    return Promise.resolve(name);
  }

  exportLibrary(items: LibraryItem[]): Promise<boolean> {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ lumoraLibrary: 1, items }, null, 2)], { type: 'application/json' }));
    a.download = 'Lumora library.lumora-library';
    a.click();
    return Promise.resolve(true);
  }

  chooseVideoFile(name: string, format: VideoFormat): Promise<string | null> {
    return Promise.resolve(`${name}.${format}`);
  }

  exportStart(): Promise<number> {
    return Promise.reject(new Error('Exporting video works in the Lumora app (it uses FFmpeg).'));
  }

  exportFrame(): Promise<void> {
    return Promise.reject(new Error('That export has stopped.'));
  }

  exportFinish(): Promise<string> {
    return Promise.reject(new Error('That export has stopped.'));
  }

  exportCancel(): Promise<void> {
    return Promise.resolve();
  }

  browserInfo(): Promise<{ port: number | null; captured: boolean }> {
    return Promise.resolve({ port: null, captured: false });
  }

  browserPage(): Promise<void> {
    return Promise.reject(new Error('In the Lumora app the page opens in its own window, to click on.'));
  }

  browserNav(): Promise<void> {
    return Promise.resolve();
  }

  streamStatus(): Promise<Record<string, { live: boolean; problem: string | null }>> {
    return Promise.resolve({});
  }

  captureChoices(): Promise<CaptureChoice[]> {
    return Promise.resolve([]);
  }

  ptz(): Promise<void> {
    return Promise.reject(new Error('PTZ cameras are moved by the Lumora app.'));
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
