import { useSyncExternalStore } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { mediaFrom } from '../model/build';
import { uid, type Project } from '../model/types';
import type { Doc } from '../doc';
import { fileName, inApp, native, onImportProgress } from '../native';

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
      try {
        const prepared = await native.importMedia(path);
        const item = mediaFrom(prepared, fileName(path).replace(/\.[^.]+$/, ''), bin);
        added.push(item.id);
        doc.edit((p: Project) => ({ ...p, media: [...p.media, item] }), 'Import');
        importing.set(importing.list.filter((x) => x.path !== path));
      } catch (e) {
        const problem = e instanceof Error ? e.message : String(e);
        importing.set(importing.list.map((x) => (x.path === path ? { ...x, problem } : x)));
      }
    }
  };
  await Promise.all([run(), run()]);
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

export const dismissProblem = (path: string) => importing.set(importing.list.filter((x) => x.path !== path));

export const newBinId = () => uid('b');
