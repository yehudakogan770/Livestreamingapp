// Talks to the Lumora engine.
//
// Inside the Lumora app this goes through Tauri to the Rust engine. When the
// UI is opened in a plain browser (for design work), a read-only stand-in is
// used so the screens still render.

import type { Action } from './types/Action';
import type { ActionError } from './types/ActionError';
import type { Show } from './types/Show';

export interface ShowSnapshot {
  revision: number;
  show: Show;
}

export interface EngineClient {
  /** True when connected to the real engine. */
  readonly live: boolean;
  getShow(): Promise<ShowSnapshot>;
  /** Resolves when applied; rejects with an {@link EngineError} if refused. */
  dispatch(action: Action): Promise<void>;
  /** Called with every new version of the show. Returns an unsubscribe function. */
  subscribe(onChange: (snapshot: ShowSnapshot) => void): () => void;
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
      return 'The Lumora engine is not running (browser preview).';
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
    settings: { displays: { live: null, back: null, monitor: null }, autoPlayOnTake: true },
  };
}

export function isInsideLumora(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

class TauriClient implements EngineClient {
  readonly live = true;

  async getShow(): Promise<ShowSnapshot> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<ShowSnapshot>('get_show');
  }

  async dispatch(action: Action): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('dispatch', { action });
    } catch (err) {
      throw new EngineError(err as ActionError);
    }
  }

  subscribe(onChange: (snapshot: ShowSnapshot) => void): () => void {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<ShowSnapshot>('show-changed', (e) => onChange(e.payload)).then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      }),
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }
}

class PreviewClient implements EngineClient {
  readonly live = false;
  getShow(): Promise<ShowSnapshot> {
    return Promise.resolve({ revision: 0, show: emptyShow() });
  }
  dispatch(): Promise<void> {
    return Promise.reject(new EngineError({ code: 'unavailable' }));
  }
  subscribe(): () => void {
    return () => {};
  }
}

export function createEngineClient(): EngineClient {
  return isInsideLumora() ? new TauriClient() : new PreviewClient();
}
