import { useSyncExternalStore } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { linkPrepared, mediaFrom, setPlaybackProxy } from '../model/build';
import { uid, type MediaItem, type Project } from '../model/types';
import type { Doc } from '../doc';
import { fileName, inApp, native, onImportProgress, onProxyProgress } from '../native';
import { wantsProxy } from '../player/files';
import { shotsAfterImport } from '../manage/shots';

export const MEDIA_EXTENSIONS = [
  'mp4',
  'mov',
  'm4v',
  'mkv',
  'webm',
  'avi',
  'wmv',
  'mpg',
  'mpeg',
  'mts',
  'm2ts',
  'ts',
  'mxf',
  'flv',
  '3gp',
  'mp3',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'opus',
  'flac',
  'wma',
  'aiff',
  'aif',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
  'avif',
];

export interface Importing {
  path: string;
  name: string;
  done: number;
  problem?: string;
}

/** Files being got ready (shown in the bin with how far along they are). */
class Queue {
  list: Importing[] = [];
  private listeners = new Set<() => void>();
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  set(list: Importing[]) {
    this.list = list;
    for (const f of this.listeners) f();
  }
}
export const importing = new Queue();
onImportProgress(([path, done]) => importing.set(importing.list.map((x) => (x.path === path ? { ...x, done } : x))));
onProxyProgress(([path, done]) => importing.set(importing.list.map((x) => (x.path === `proxy:${path}` ? { ...x, done } : x))));

export function useImporting(): Importing[] {
  return useSyncExternalStore(importing.subscribe, () => importing.list);
}

/** Add files to the project (in a bin), each made ready to edit. */
export async function importFiles(doc: Doc, paths: string[], bin: string | null): Promise<string[]> {
  const fresh = paths.filter((p) => !doc.project.media.some((m) => m.path === p));
  if (!fresh.length) return [];
  importing.set([...importing.list, ...fresh.map((path) => ({ path, name: fileName(path), done: 0 }))]);
  const added: string[] = [];
  // A few at a time: making copies is heavy work.
  const work = [...fresh];
  const run = async () => {
    for (let path = work.shift(); path; path = work.shift()) {
      const name = fileName(path).replace(/\.[^.]+$/, '');
      let item: MediaItem | null = null;
      try {
        // A quick look first: the file is in the bin straight away, and any copy it needs is made in the background.
        const look = await native.probeMedia(path).catch(() => null);
        if (look) {
          const it = mediaFrom(look, name, bin);
          item = it;
          added.push(it.id);
          doc.edit((p: Project) => ({ ...p, media: [...p.media, it] }), 'Import');
        }
        if (!look?.pending) {
          if (!item) {
            const prepared = await native.importMedia(path);
            const it = mediaFrom(prepared, name, bin);
            item = it;
            added.push(it.id);
            doc.edit((p: Project) => ({ ...p, media: [...p.media, it] }), 'Import');
          }
        } else if (item) {
          const prepared = await native.importMedia(path);
          const id = item.id;
          // Linked without a step to undo (the copy simply takes over playback).
          doc.rebase((p) => linkPrepared(p, id, prepared), true);
          item = doc.project.media.find((m) => m.id === id) ?? item;
        }
        importing.set(importing.list.filter((x) => x.path !== path));
        if (item) makeProxies(doc, [item]);
      } catch (e) {
        const problem = e instanceof Error ? e.message : String(e);
        importing.set(importing.list.map((x) => (x.path === path ? { ...x, problem } : x)));
        const id = item?.id;
        if (id) doc.rebase((p) => ({ ...p, media: p.media.map((m) => (m.id === id ? { ...m, preparing: false } : m)) }), true);
      }
    }
  };
  await Promise.all([run(), run()]);
  void shotsAfterImport(doc, added);
  return added;
}

export async function chooseAndImport(doc: Doc, bin: string | null): Promise<void> {
  if (!inApp()) return;
  const picked = await open({
    title: 'Import media',
    multiple: true,
    filters: [
      { name: 'Video, sound and pictures', extensions: MEDIA_EXTENSIONS },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  const paths = Array.isArray(picked) ? picked : typeof picked === 'string' ? [picked] : [];
  if (paths.length) await importFiles(doc, paths, bin);
}

/** Playback proxies being made, one at a time (heavy work, in the background). */
const proxyJobs: { id: string; path: string }[] = [];
let proxyBusy = false;

/** Make playback proxies for heavy files that don't have one yet (4K and up, high bit rates, HEVC). */
export function makeProxies(doc: Doc, media: MediaItem[]) {
  if (!inApp()) return;
  for (const m of media) {
    if (!wantsProxy(m) || proxyJobs.some((j) => j.id === m.id)) continue;
    proxyJobs.push({ id: m.id, path: m.path });
    importing.set([...importing.list, { path: `proxy:${m.path}`, name: `${m.name} (proxy)`, done: 0 }]);
  }
  void pumpProxies(doc);
}

async function pumpProxies(doc: Doc) {
  if (proxyBusy) return;
  proxyBusy = true;
  try {
    for (let job = proxyJobs[0]; job; job = proxyJobs[0]) {
      const key = `proxy:${job.path}`;
      try {
        const out = await native.makeProxy(job.path);
        const id = job.id;
        doc.rebase((p) => setPlaybackProxy(p, id, out), true);
        importing.set(importing.list.filter((x) => x.path !== key));
      } catch (e) {
        const problem = `No proxy: ${e instanceof Error ? e.message : String(e)}`;
        importing.set(importing.list.map((x) => (x.path === key ? { ...x, problem } : x)));
      }
      proxyJobs.shift();
    }
  } finally {
    proxyBusy = false;
  }
}

export const dismissProblem = (path: string) => importing.set(importing.list.filter((x) => x.path !== path));

export const newBinId = () => uid('b');
