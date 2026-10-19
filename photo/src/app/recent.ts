// Recent files for the start screen: name, size, a small picture, and how to
// open it again (a desktop path, or in the browser a file handle kept in
// IndexedDB where the browser allows it).

import type { PickedFile } from './host';
import type { Doc } from '../core/types';
import { flatten, canvasRect } from './ops/common';
import { resize } from '../core/img';
import { encode, convertColor, SRGB } from '../core/color';

export interface RecentFile {
  id: string;
  name: string;
  path?: string;
  size: string;
  time: number;
  /** A small JPEG data URL. */
  thumb: string;
}

const KEY = 'lumora.photo.recent';
const DB = 'lumora-photo';

export function recentFiles(): RecentFile[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as RecentFile[];
  } catch {
    return [];
  }
}

function store(list: RecentFile[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 16)));
  } catch {
    /* full: keep fewer */
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, 6)));
    } catch {
      /* nothing kept */
    }
  }
}

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function putHandle(id: string, h: FileSystemFileHandle): Promise<void> {
  const db = await idb();
  if (!db) return;
  await new Promise<void>((res) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(h, id);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

export async function getHandle(id: string): Promise<FileSystemFileHandle | null> {
  const db = await idb();
  if (!db) return null;
  return new Promise((res) => {
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get(id);
    req.onsuccess = () => res((req.result as FileSystemFileHandle | undefined) ?? null);
    req.onerror = () => res(null);
  });
}

function thumb(doc: Doc): string {
  try {
    const s = Math.min(1, 240 / Math.max(doc.width, doc.height));
    const px = flatten(doc, canvasRect(doc));
    const small = resize(
      { w: doc.width, h: doc.height, c: 4, data: px },
      Math.max(1, Math.round(doc.width * s)),
      Math.max(1, Math.round(doc.height * s)),
      'bilinear',
    );
    const c = document.createElement('canvas');
    c.width = small.w;
    c.height = small.h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(small.w, small.h);
    for (let i = 0; i < small.data.length; i += 4) {
      let rgb = [small.data[i]!, small.data[i + 1]!, small.data[i + 2]!];
      if (doc.depth === 32) rgb = rgb.map((v) => encode(doc.profile.trc, Math.max(0, Math.min(1, v))));
      if (doc.profile.id !== 'srgb') rgb = convertColor(rgb, doc.profile, SRGB);
      const a = small.data[i + 3]!;
      // On a light checker-free gray so transparency reads.
      for (let k = 0; k < 3; k++) img.data[i + k] = Math.round((rgb[k]! * a + 0.86 * (1 - a)) * 255);
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.8);
  } catch {
    return '';
  }
}

export async function rememberRecent(f: PickedFile, doc: Doc): Promise<void> {
  const id = f.path ?? `${f.name}:${f.handle ? 'h' : 'n'}`;
  const entry: RecentFile = { id, name: f.name, path: f.path, size: `${doc.width} × ${doc.height}`, time: Date.now(), thumb: thumb(doc) };
  if (f.handle) await putHandle(id, f.handle);
  store([entry, ...recentFiles().filter((r) => r.id !== id)]);
}

export function forgetRecent(id: string): void {
  store(recentFiles().filter((r) => r.id !== id));
}
