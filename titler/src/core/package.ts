// .lumtitle files: a project with its pictures, videos, sounds and fonts
// inside (as data URLs), so it opens the same on any computer.

import { parseProject, type ReadResult } from './validate';
import type { Asset, TitleProject } from './types';

export const EXTENSION = 'lumtitle';
export const MIME = 'application/x-lumora-title+json';

/** Is this asset already inside the file? */
export const embedded = (a: Asset) => a.src.startsWith('data:') && (!a.frames || a.frames.every((f) => f.startsWith('data:')));

/**
 * The project as a .lumtitle file's text. `read` turns a file path or URL
 * into a data URL (null: leave it as a link, e.g. a large video).
 */
export async function pack(p: TitleProject, read?: (src: string) => Promise<string | null>): Promise<string> {
  const assets: Asset[] = [];
  for (const a of p.assets) {
    if (embedded(a) || !read) {
      assets.push(a);
      continue;
    }
    const src = a.src.startsWith('data:') ? a.src : ((await read(a.src).catch(() => null)) ?? a.src);
    const frames = a.frames ? await Promise.all(a.frames.map(async (f) => (f.startsWith('data:') ? f : ((await read(f).catch(() => null)) ?? f)))) : undefined;
    assets.push({ ...a, src, ...(frames ? { frames } : {}) });
  }
  return JSON.stringify({ ...p, assets, modified: p.modified ?? Date.now() }, null, 1);
}

/** Read a .lumtitle file's text. */
export const unpack = (text: string): ReadResult => parseProject(text);

/** Font assets to load before drawing (family and data). */
export const fontAssets = (p: TitleProject) => p.assets.filter((a) => a.kind === 'font' && a.family);

/** A safe file name for a project. */
export const fileName = (p: TitleProject) =>
  `${
    p.name
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Title'
  }.${EXTENSION}`;

/** Read a file into a data URL (browser). */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}
