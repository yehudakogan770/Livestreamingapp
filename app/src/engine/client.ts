// Talks to the Lumora engine.
//
// Inside the Lumora app this goes through Tauri to the Rust engine. When the
// UI is opened in a plain browser (design work, UI tests), a demo engine that
// follows the same rules is used so every screen can be tried out.

import type { Action } from './types/Action';
import type { ActionError } from './types/ActionError';
import type { ScreenId } from './types/ScreenId';
import type { Show } from './types/Show';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { demoApply } from './demo';

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

export type MediaKind = 'video' | 'image';

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

  // ----- files -----
  /** Ask the operator for a video or picture file. Resolves to its path, or null if cancelled. */
  pickFile(kind: MediaKind): Promise<{ path: string; name: string } | null>;
  /** A URL the page can load a file path from. */
  mediaUrl(path: string): string;
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
    case 'invalidValue':
      return `${detail.field}: ${detail.reason}`;
    case 'unavailable':
      return 'Not available in the browser demo. Open Lumora itself for this.';
  }
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
    version: 1,
    sources: [],
    screens: { live: { ...screen }, back: { ...screen }, monitor: { ...screen } },
    transition: { kind: 'fade', durationMs: 800 },
    panic: false,
    panicChangedAt: 0,
    masterVolume: 1,
    backFollowsLive: false,
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
    countdown: {
      lengthMs: 300_000,
      endsAt: null,
      remainingMs: 300_000,
      label: 'Starting soon',
      endText: 'Welcome!',
      onLive: false,
      onBack: false,
      format: 'auto',
      atZero: { type: 'hold' },
      fired: false,
    },
    settings: { displays: { live: null, back: null, monitor: null }, autoPlayOnTake: true },
  };
}

export function isInsideLumora(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const FILTERS: Record<MediaKind, { name: string; extensions: string[] }> = {
  video: { name: 'Videos', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'mpg', 'mpeg'] },
  image: { name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
};

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

  async pickFile(kind: MediaKind): Promise<{ path: string; name: string } | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({ multiple: false, directory: false, filters: [FILTERS[kind]] });
    return typeof path === 'string' ? { path, name: baseName(path) } : null;
  }

  mediaUrl(path: string): string {
    if (/^(blob:|data:|https?:)/.test(path)) return path;
    return convertFileSrc(path);
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
  }

  getShow(): Promise<ShowSnapshot> {
    return Promise.resolve(this.snapshot);
  }

  dispatch(action: Action): Promise<void> {
    try {
      const show = demoApply(this.snapshot.show, action, Date.now());
      if (JSON.stringify(show) === JSON.stringify(this.snapshot.show)) return Promise.resolve();
      this.snapshot = { revision: this.snapshot.revision + 1, show };
      for (const l of this.listeners) l(this.snapshot);
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

  pickFile(kind: MediaKind): Promise<{ path: string; name: string } | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = FILTERS[kind].extensions.map((e) => '.' + e).join(',');
      input.onchange = () => {
        const f = input.files?.[0];
        resolve(f ? { path: URL.createObjectURL(f), name: baseName(f.name) } : null);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  mediaUrl(path: string): string {
    return path;
  }
}

export function createEngineClient(): EngineClient {
  return isInsideLumora() ? new TauriClient() : new DemoClient();
}
