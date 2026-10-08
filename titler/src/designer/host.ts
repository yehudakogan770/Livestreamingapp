// What the designer needs from where it runs: files, the shared title
// library, autosave and rendering. The web app keeps things in the browser;
// the desktop app, Lumora and Studio use files in Documents/Lumora/Titles.

import type { TitleProject } from '../core/types';
import { fileName, pack, unpack } from '../core/package';
import type { ReadResult } from '../core/validate';

export interface LibraryEntry {
  /** The file (or browser key). */
  id: string;
  name: string;
  category: string;
  modified: number;
}

export interface VideoTarget {
  /** Where the film goes (desktop) or the download name (web). */
  name: string;
  format: 'prores4444' | 'webm-alpha' | 'mp4' | 'png-sequence';
}

/** Frames handed to a renderer one at a time (RGBA, straight alpha). */
export interface FrameSink {
  frame(rgba: Uint8ClampedArray, w: number, h: number): Promise<void>;
  finish(): Promise<string>;
  cancel(): Promise<void>;
}

export interface Host {
  /** Where it runs (changes some wording and what is offered). */
  kind: 'web' | 'desktop' | 'lumora' | 'studio';
  /** Library folder wording ("Documents/Lumora/Titles" or "this browser"). */
  libraryName: string;
  listLibrary(): Promise<LibraryEntry[]>;
  readLibrary(id: string): Promise<ReadResult>;
  /** Save into the library; returns its id. */
  saveLibrary(p: TitleProject, id?: string | null): Promise<string>;
  removeLibrary(id: string): Promise<void>;
  /** Choose a .lumtitle file to open (null: cancelled). */
  openFile(): Promise<{ result: ReadResult; path: string | null } | null>;
  /** Save as a .lumtitle file (a download on the web). Returns the path or null if cancelled. */
  saveFile(p: TitleProject, path?: string | null): Promise<string | null>;
  /** Choose pictures, SVG logos, videos or fonts to add; their sources (data URLs or paths). */
  pickFiles(kind: 'image' | 'video' | 'font' | 'audio' | 'sequence'): Promise<{ name: string; src: string }[]>;
  /** The URL to load a file path in this window. */
  urlFor(src: string): string;
  /** Turn a linked file into a data URL (for packages). */
  readAsDataUrl?(src: string): Promise<string | null>;
  /** The kept copy of the project being edited (crash recovery). */
  autosave(p: TitleProject | null): void;
  recover(): Promise<TitleProject | null>;
  /** Rendering to a film through FFmpeg (desktop): null when not available here. */
  renderTo?(target: VideoTarget, w: number, h: number, fps: number): Promise<FrameSink | null>;
  /** Formats this host can render. */
  renderFormats: VideoTarget['format'][];
}

// ---- the web app: the browser keeps the library and the autosave ----

const LIB_KEY = 'lumora-titler-library';
const AUTO_KEY = 'lumora-titler-autosave';

function readStore(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LIB_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function writeStore(o: Record<string, string>) {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(o));
  } catch {
    throw new Error('The browser has no room left to keep this title. Save it as a file instead.');
  }
}

function pickBrowserFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

export function readFileAsDataUrl(f: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(f);
  });
}

export function download(name: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const ACCEPT: Record<string, string> = {
  image: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg',
  video: 'video/webm,video/mp4,video/quicktime,.webm,.mp4,.mov',
  font: '.ttf,.otf,.woff,.woff2',
  audio: 'audio/*,.wav,.mp3,.m4a,.ogg',
  sequence: 'image/png,image/jpeg,image/webp',
};

export function webHost(): Host {
  return {
    kind: 'web',
    libraryName: 'this browser',
    renderFormats: ['webm-alpha', 'png-sequence'],
    async listLibrary() {
      const out: LibraryEntry[] = [];
      for (const [id, text] of Object.entries(readStore())) {
        const r = unpack(text);
        if (r.project) out.push({ id, name: r.project.name, category: r.project.category, modified: r.project.modified ?? 0 });
      }
      return out.sort((a, b) => b.modified - a.modified);
    },
    async readLibrary(id) {
      const text = readStore()[id];
      return text ? unpack(text) : { project: null, error: 'That title is no longer in the library.', notes: [] };
    },
    async saveLibrary(p, id) {
      const key = id ?? p.id;
      const all = readStore();
      all[key] = await pack({ ...p, modified: Date.now() });
      writeStore(all);
      return key;
    },
    async removeLibrary(id) {
      const all = readStore();
      delete all[id];
      writeStore(all);
    },
    async openFile() {
      const [f] = await pickBrowserFiles('.lumtitle,application/json', false);
      if (!f) return null;
      return { result: unpack(await f.text()), path: f.name };
    },
    async saveFile(p) {
      const text = await pack({ ...p, modified: Date.now() });
      download(fileName(p), new Blob([text], { type: 'application/json' }));
      return fileName(p);
    },
    async pickFiles(kind) {
      const files = await pickBrowserFiles(ACCEPT[kind] ?? '*/*', true);
      return Promise.all(files.map(async (f) => ({ name: f.name, src: await readFileAsDataUrl(f) })));
    },
    urlFor: (s) => s,
    autosave(p) {
      try {
        if (p) localStorage.setItem(AUTO_KEY, JSON.stringify({ ...p, modified: Date.now() }));
        else localStorage.removeItem(AUTO_KEY);
      } catch {
        /* no room: autosave skipped */
      }
    },
    async recover() {
      try {
        const text = localStorage.getItem(AUTO_KEY);
        return text ? unpack(text).project : null;
      } catch {
        return null;
      }
    },
  };
}
