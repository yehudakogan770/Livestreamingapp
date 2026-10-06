// Making the picture side of media search: each file's frames are looked at
// once (every couple of seconds) by the face, object and scene models in a
// worker, and what was seen is kept with the file's other analysis.
import type { MediaItem } from '../model/types';
import { inApp, mediaUrl, native, onSpeechProgress } from '../native';
import { check, type Job } from '../smart/analysis';
import { decodedFile } from '../vision/frames';
import { decodeLooks, encodeLooks, lookTimes, type Look, type LookIndex } from './search';

const KIND = 'looks';
/** Frames are looked at this wide. */
const WIDTH = 320;
/** At most this many frames a file. */
const MOST = 600;

const indexes = new Map<string, LookIndex>();
const keyOf = (m: MediaItem) => decodedFile(m);

/** The files that have a picture index (by media id). */
export async function knownLooks(media: MediaItem[]): Promise<Map<string, LookIndex>> {
  const out = new Map<string, LookIndex>();
  for (const m of media) {
    let x = indexes.get(keyOf(m));
    if (!x && inApp() && m.hasVideo) {
      x = decodeLooks(await native.matteRead(keyOf(m), KIND).catch(() => new Uint8Array())) ?? undefined;
      if (x) indexes.set(keyOf(m), x);
    }
    if (x) out.set(m.id, x);
  }
  return out;
}

class LookFinder {
  private worker: Worker | null = null;
  private next = 1;
  private waiting = new Map<number, { done: (l: Look[]) => void; progress: (d: number) => void }>();
  /** The scene classifier could be used (downloaded). */
  scenes = false;

  async start(report: (message: string) => void): Promise<void> {
    if (this.worker) return;
    // The scene classifier is downloaded the first time (about 5 MB); search works without it.
    let classifier: string | null = null;
    if (inApp()) {
      const off = onSpeechProgress(
        ([name, done]) => name === 'vision-classifier' && report(`Downloading the scene model (one time only): ${Math.round(done * 100)}%`),
      );
      try {
        const folder = await native.speechModel('vision-classifier');
        const sep = folder.includes('\\') ? '\\' : '/';
        classifier = mediaUrl(`${folder}${sep}efficientnet_lite0.tflite`);
      } catch {
        classifier = null;
      } finally {
        off();
      }
    }
    const worker = new Worker(new URL('./look.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    const ready = new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ type: string; message?: string; classifier?: boolean }>) => {
        if (e.data.type === 'ready') {
          this.scenes = !!e.data.classifier;
          resolve();
        } else reject(new Error(e.data.message ?? 'The picture models could not start.'));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'The picture models could not start.'));
      const at = (p: string) => new URL(p, document.baseURI).href;
      worker.postMessage({
        type: 'load',
        wasm: at('mediapipe/'),
        face: at('models/blaze_face_short_range.tflite'),
        objects: at('models/efficientdet_lite0.tflite'),
        classifier,
      });
    });
    try {
      await ready;
    } catch (e) {
      // It couldn't start: let it go, so the next start makes a new one (rather than asking one that never answers).
      this.stop();
      throw e;
    }
    // It stopped working: whatever was asked is given back empty (nothing waits forever).
    worker.onerror = () => this.stop();
    worker.onmessage = (e: MessageEvent<{ type: string; id: number; done?: number; looks?: Look[] }>) => {
      const w = this.waiting.get(e.data.id);
      if (!w) return;
      if (e.data.type === 'progress') w.progress(e.data.done ?? 0);
      else {
        this.waiting.delete(e.data.id);
        w.done(e.data.looks ?? []);
      }
    };
  }

  look(m: MediaItem, times: number[], progress: (d: number) => void): Promise<Look[]> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, { done: resolve, progress });
      this.worker?.postMessage({ type: 'look', id, url: mediaUrl(decodedFile(m)), times, width: WIDTH, still: m.kind === 'image' });
    });
  }

  stop() {
    this.worker?.terminate();
    this.worker = null;
    for (const w of this.waiting.values()) w.done([]);
    this.waiting.clear();
  }
}

/** Look at every file that has no picture index yet (or all of them, `again`). */
export async function indexPictures(media: MediaItem[], job: Job, again = false): Promise<{ looks: Map<string, LookIndex>; scenes: boolean }> {
  const have = again ? new Map<string, LookIndex>() : await knownLooks(media);
  const todo = media.filter((m) => m.hasVideo && !m.missing && !have.has(m.id));
  const finder = new LookFinder();
  job.signal.addEventListener('abort', () => finder.stop());
  try {
    if (todo.length) {
      job.progress(0, 'Starting the picture models…');
      await finder.start((msg) => job.progress(0, msg));
    }
    await lookAtAll(todo, have, finder, job);
  } finally {
    // Done, stopped or failed: the worker goes.
    finder.stop();
  }
  return { looks: have, scenes: finder.scenes };
}

async function lookAtAll(todo: MediaItem[], have: Map<string, LookIndex>, finder: LookFinder, job: Job) {
  for (const [i, m] of todo.entries()) {
    check(job);
    const every = Math.max(2, (m.duration || 0) / MOST);
    const times = m.kind === 'image' ? [0] : lookTimes(m.duration, every);
    const looks = await finder.look(m, times, (d) => job.progress((i + d) / todo.length, `Looking at ${m.name}…`));
    check(job);
    const index: LookIndex = { version: 1, every, looks };
    indexes.set(keyOf(m), index);
    have.set(m.id, index);
    if (inApp()) void native.matteWrite(keyOf(m), KIND, encodeLooks(index)).catch(() => undefined);
  }
}
