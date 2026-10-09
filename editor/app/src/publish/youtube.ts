// Publishing a finished film to YouTube: the channel connection, the upload
// (done by the program, which carries on after a dropped connection) and a
// small store of uploads in progress that any window part can show.
import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isChapterMarker } from '../extras/chapters';
import { chaptersFrom, youtubeChapters } from '../export/chapters';
import type { Marker } from '../model/types';
import { inApp } from '../native';

export interface YoutubeInfo {
  setUp: boolean;
  connected: boolean;
  channel: string;
}

export type Visibility = 'private' | 'unlisted' | 'public';

export interface VideoDetails {
  title: string;
  description: string;
  tags: string[];
  category: string;
  visibility: Visibility;
  madeForKids: boolean;
}

export interface Published {
  id: string;
  url: string;
  notes: string[];
}

/** YouTube's categories people pick most (its own numbers). */
export const CATEGORIES: [string, string][] = [
  ['22', 'People & Blogs'],
  ['24', 'Entertainment'],
  ['27', 'Education'],
  ['29', 'Nonprofits & Activism'],
  ['10', 'Music'],
  ['17', 'Sports'],
  ['25', 'News & Politics'],
  ['26', 'Howto & Style'],
  ['1', 'Film & Animation'],
  ['19', 'Travel & Events'],
  ['28', 'Science & Technology'],
  ['23', 'Comedy'],
  ['20', 'Gaming'],
];

export const youtube = {
  info: (): Promise<YoutubeInfo> => (inApp() ? invoke<YoutubeInfo>('youtube_info') : Promise.resolve({ setUp: false, connected: false, channel: '' })),
  connect: () => invoke<YoutubeInfo>('youtube_connect'),
  cancel: () => invoke<void>('youtube_cancel'),
  disconnect: () => invoke<YoutubeInfo>('youtube_disconnect'),
  watch: (id: string) => invoke<void>('youtube_watch', { id }),
  stop: (job: string) => invoke<void>('youtube_stop', { job }),
};

/** Problems with the details before anything is sent (the program checks them again). */
export function checkDetails(d: VideoDetails): string | null {
  const title = d.title.trim();
  if (!title) return 'Give the video a title.';
  if ([...title].length > 100) return 'The title is too long: YouTube takes 100 characters at most.';
  if (/[<>]/.test(title) || /[<>]/.test(d.description)) return 'YouTube doesn’t take < or > in a title or description.';
  if (new TextEncoder().encode(d.description).length > 5000) return 'The description is too long: YouTube takes about 5,000 letters.';
  if (d.tags.join(',').length > 500) return 'Too many tags: YouTube takes 500 letters of tags in all.';
  return null;
}

/**
 * The description to start from: the chapter list YouTube turns into
 * chapters (from the chapter markers, or every marker when there are none),
 * when there are at least three of ten seconds or more, starting at 0:00.
 */
export function startingDescription(markers: Marker[], fps: number, range: { from: number; to: number }): string {
  const chapterMarkers = markers.filter(isChapterMarker);
  const list = chaptersFrom(chapterMarkers.length ? chapterMarkers : markers, fps, range).map((c) => ({
    ...c,
    title: c.title.replace(/^Chapter: /, ''),
  }));
  const usable = list.length >= 3 && list.every((c) => c.end - c.start >= 10);
  return usable ? `Chapters\n${youtubeChapters(list)}\n` : '';
}

// ---------------------------------------------------------------------------
// Uploads in progress.

export interface Upload {
  /** The render queue job it came from. */
  job: string;
  title: string;
  stage: 'starting' | 'uploading' | 'finishing' | 'done' | 'failed' | 'stopped';
  bytes: number;
  total: number;
  result?: Published;
  error?: string;
}

let uploads: Record<string, Upload> = {};
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());
const put = (job: string, change: Partial<Upload>) => {
  const before = uploads[job];
  if (!before) return;
  uploads = { ...uploads, [job]: { ...before, ...change } };
  changed();
};

let listening = false;
function listenOnce() {
  if (listening || !inApp()) return;
  listening = true;
  void listen<{ job: string; stage: Upload['stage']; bytes: number; total: number }>('youtube-upload', (e) => {
    const u = uploads[e.payload.job];
    // The program says "done" before the answer comes back with the link: that sets it.
    if (u && u.stage !== 'done')
      put(e.payload.job, { stage: e.payload.stage === 'done' ? 'finishing' : e.payload.stage, bytes: e.payload.bytes, total: e.payload.total });
  });
}

/** Send a finished film to YouTube; it keeps going while Studio is open, whatever window is shown. */
export async function publish(
  job: string,
  path: string,
  details: VideoDetails,
  extras: { thumbnail?: string | null; captions?: { path: string; language: string; name: string } | null } = {},
): Promise<Published> {
  listenOnce();
  uploads = { ...uploads, [job]: { job, title: details.title, stage: 'starting', bytes: 0, total: 0 } };
  changed();
  try {
    const result = await invoke<Published>('youtube_upload', {
      job,
      path,
      details,
      thumbnail: extras.thumbnail ?? null,
      captions: extras.captions ?? null,
    });
    put(job, { stage: 'done', result, bytes: uploads[job]?.total ?? 0 });
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    put(job, { stage: /stopped/i.test(error) ? 'stopped' : 'failed', error });
    throw new Error(error);
  }
}

export function useUploads(): Record<string, Upload> {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => uploads,
  );
}

/** For tests: forget every upload. */
export function resetUploads() {
  uploads = {};
  changed();
}
