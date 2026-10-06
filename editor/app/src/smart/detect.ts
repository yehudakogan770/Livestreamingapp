// The face finder, from the screens' side: starts the worker and asks it to
// look at a file's frames.
import { mediaUrl } from '../native';
import type { Found } from './reframe';

/** Frames are looked at this wide (faces of people in a room are still found). */
export const LOOK_WIDTH = 320;

export class FaceFinder {
  private worker: Worker | null = null;
  private next = 1;
  private waiting = new Map<number, { done: (f: Found[][]) => void; progress: (d: number) => void }>();

  async start(): Promise<void> {
    if (this.worker) return;
    const worker = new Worker(new URL('./detect.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    const ready = new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ type: string; message?: string }>) =>
        e.data.type === 'ready' ? resolve() : reject(new Error(e.data.message ?? 'The face finder could not start.'));
      worker.onerror = (e) => reject(new Error(e.message || 'The face finder could not start.'));
      const at = (p: string) => new URL(p, document.baseURI).href;
      worker.postMessage({
        type: 'load',
        wasm: at('mediapipe/'),
        face: at('models/blaze_face_short_range.tflite'),
        person: at('models/efficientdet_lite0.tflite'),
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
    worker.onmessage = (e: MessageEvent<{ type: string; id: number; done?: number; found?: Found[][] }>) => {
      const w = this.waiting.get(e.data.id);
      if (!w) return;
      if (e.data.type === 'progress') w.progress(e.data.done ?? 0);
      else {
        this.waiting.delete(e.data.id);
        w.done(e.data.found ?? []);
      }
    };
  }

  /** What is found at each time (seconds) of a file. */
  look(path: string, times: number[], progress: (d: number) => void = () => {}): Promise<Found[][]> {
    const id = this.next++;
    // Decoded in order, then given back in the order asked.
    const order = times.map((t, i) => [t, i] as const).sort((a, b) => a[0] - b[0]);
    return new Promise<Found[][]>((resolve) => {
      this.waiting.set(id, {
        progress,
        done: (found) => {
          const out: Found[][] = times.map(() => []);
          order.forEach(([, i], k) => (out[i] = found[k] ?? []));
          resolve(out);
        },
      });
      this.worker?.postMessage({ type: 'look', id, url: mediaUrl(path), times: order.map(([t]) => t), width: LOOK_WIDTH });
    });
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const w of this.waiting.values()) w.done([]);
    this.waiting.clear();
  }
}
