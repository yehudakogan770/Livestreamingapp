import { useSyncExternalStore } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { linkPrepared, mediaFrom, setPlaybackProxy } from '../model/build';
import { uid, type MediaItem, type Project } from '../model/types';
import type { Doc } from '../doc';
import { fileName, inApp, native, onImportProgress, onProxyProgress } from '../native';
import { wantsProxy } from '../player/files';
import { shotsAfterImport } from '../manage/shots';
import { ProxyScheduler } from '../cache/proxyqueue';
import { manageNative } from '../manage/native';
import { numberedRuns, rawCameraProblem, RAW_EXTENSIONS } from './camerafiles';

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
  'dpx',
  'exr',
  // Camera RAW: not read, but chosen and dropped files say how to convert them.
  ...RAW_EXTENSIONS,
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
  let fresh = paths.filter((p) => !doc.project.media.some((m) => m.path === p));
  // Camera RAW files: say how to convert them.
  const raw = fresh.filter((p) => rawCameraProblem(p));
  if (raw.length) importing.set([...importing.list, ...raw.map((path) => ({ path, name: fileName(path), done: 0, problem: rawCameraProblem(path) ?? '' }))]);
  fresh = fresh.filter((p) => !rawCameraProblem(p));
  // Numbered pictures (ten or more) come in as one clip at the sequence's frame rate.
  const { sequences, rest } = numberedRuns(fresh);
  if (sequences.length && inApp()) {
    const fps = doc.project.sequences.find((s) => s.id === doc.project.open)?.fps ?? 30;
    fresh = rest;
    for (const seq of sequences) {
      const key = `sequence:${seq.first}`;
      importing.set([...importing.list, { path: key, name: `${fileName(seq.first)} and ${seq.count - 1} more frames`, done: 0 }]);
      try {
        const video = await manageNative.imageSequence(seq.first, fps);
        importing.set(importing.list.filter((x) => x.path !== key));
        if (!doc.project.media.some((m) => m.path === video)) fresh.push(video);
      } catch (e) {
        const problem = e instanceof Error ? e.message : String(e);
        importing.set(importing.list.map((x) => (x.path === key ? { ...x, problem } : x)));
      }
    }
  }
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

/** Where the playhead is (proxies for the files near it are made first). */
let focus: () => { p: Project | null; playhead: number } = () => ({ p: null, playhead: 0 });
export function setProxyFocus(f: () => { p: Project | null; playhead: number }) {
  focus = f;
}

/** Hardware encoding for proxies (the graphics card's encoder when one works). */
export const proxyOptions = { hardware: true };

let proxyDoc: Doc | null = null;

/** Playback proxies being made, a few at a time (heavy work, in the background), nearest the playhead first. */
const proxies = new ProxyScheduler(
  async (job, threads) => {
    const key = `proxy:${job.path}`;
    try {
      const out = await native.makeProxy(job.path, threads, proxyOptions.hardware);
      const id = job.id;
      proxyDoc?.rebase((p) => setPlaybackProxy(p, id, out), true);
      importing.set(importing.list.filter((x) => x.path !== key));
    } catch (e) {
      const problem = `No proxy: ${e instanceof Error ? e.message : String(e)}`;
      importing.set(importing.list.map((x) => (x.path === key ? { ...x, problem } : x)));
    }
  },
  () => focus(),
  typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4,
);

/**
 * Make playback proxies for heavy files that don't have one yet (4K and up,
 * high bit rates, HEVC). `chosen`: any video asked for by hand (made first, heavy or not).
 */
export function makeProxies(doc: Doc, media: MediaItem[], chosen = false) {
  if (!inApp()) return;
  proxyDoc = doc;
  const jobs = [];
  for (const m of media) {
    const wanted = chosen ? m.kind === 'video' && m.hasVideo && !m.missing && !m.playbackProxy : wantsProxy(m);
    if (!wanted) continue;
    if (!proxies.has(m.id)) importing.set([...importing.list, { path: `proxy:${m.path}`, name: `${m.name} (proxy)`, done: 0 }]);
    jobs.push({ id: m.id, path: m.path, urgent: chosen });
  }
  proxies.add(jobs);
}

export const dismissProblem = (path: string) => importing.set(importing.list.filter((x) => x.path !== path));

export const newBinId = () => uid('b');
