// A small pool of workers for filters and content-aware fills. A filter that
// only looks a limited distance around each pixel is split into bands of
// rows (overlapping by that distance) and run on every core at once.

import { filterById, bands, runFilter } from '../core/filters/registry';
import type { Img } from '../core/img';
import type { FilterContext, Params } from '../core/filters/types';
import { defaults } from '../core/filters/types';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

let pool: Worker[] | null = null;
let busyCount: number[] = [];
const pending = new Map<number, Pending>();
let nextId = 1;
let disabled = typeof Worker === 'undefined';

function workers(): Worker[] | null {
  if (disabled) return null;
  if (pool) return pool;
  try {
    const n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    pool = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('../workers/work.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        busyCount[i] = Math.max(0, busyCount[i]! - 1);
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error ?? 'The task failed.'));
      };
      w.onerror = () => {
        // A worker that can't start (blocked by the page's rules): do the work here instead.
        disabled = true;
      };
      pool.push(w);
    }
    busyCount = pool.map(() => 0);
    return pool;
  } catch {
    disabled = true;
    return null;
  }
}

function post<T>(msg: Record<string, unknown>, transfer: Transferable[]): Promise<T> {
  const ws = workers();
  if (!ws) return Promise.reject(new Error('no workers'));
  const id = nextId++;
  let best = 0;
  for (let i = 1; i < ws.length; i++) if (busyCount[i]! < busyCount[best]!) best = i;
  busyCount[best]!++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    ws[best]!.postMessage({ ...msg, id }, transfer);
  });
}

/** Run a named task in a worker (falling back to `local` here when workers can't run). */
export async function runInWorker<T>(kind: 'inpaint', payload: Record<string, unknown>, local: () => T): Promise<T> {
  if (!workers()) return local();
  try {
    // Copies are sent (moving the buffers would empty the caller's arrays).
    const copy: Record<string, unknown> = {};
    const transfer: Transferable[] = [];
    for (const [k, v] of Object.entries(payload)) {
      if (v instanceof Uint8Array || v instanceof Float32Array) {
        const c = v.slice();
        copy[k] = c;
        transfer.push(c.buffer);
      } else if (v && typeof v === 'object' && 'c' in v) {
        const c = (v as { c: Float32Array }).c.slice();
        copy[k] = { ...(v as object), c };
        transfer.push(c.buffer);
      } else copy[k] = v;
    }
    return await post<T>({ kind, ...copy }, transfer);
  } catch (e) {
    if (e instanceof Error && e.message === 'no workers') return local();
    throw e;
  }
}

/**
 * Run a filter on an image: split across workers when it allows, else in one
 * worker, else here. `ctx.ox/oy` place the image in the whole picture.
 */
export async function runFilterAsync(filter: string, img: Img, params: Params, ctx: FilterContext, onProgress?: (p: number) => void): Promise<Img> {
  const def = filterById(filter);
  if (!def) throw new Error(`Unknown filter “${filter}”.`);
  const p = { ...defaults(def), ...params };
  const ws = workers();
  const cleanCtx: FilterContext = { width: ctx.width, height: ctx.height, ox: ctx.ox ?? 0, oy: ctx.oy ?? 0, extra: ctx.extra };
  if (!ws) return runFilter(filter, img, p, cleanCtx);
  const reach = def.reach(p, ctx);
  const big = img.w * img.h > 300_000;
  if (!Number.isFinite(reach) || !big || ws.length < 2 || reach * 4 > img.h) {
    const copy = { ...img, data: img.data.slice() };
    onProgress?.(0.1);
    const res = await post<Img>({ kind: 'filter', filter, params: p, img: copy, ctx: cleanCtx }, [copy.data.buffer]);
    onProgress?.(1);
    return res;
  }
  const parts = bands(img.h, ws.length * 2, Math.ceil(reach));
  const out = { w: img.w, h: img.h, c: img.c, data: new Float32Array(img.data.length) };
  let done = 0;
  await Promise.all(
    parts.map(async (b) => {
      const rows = img.data.slice(b.r0 * img.w * img.c, b.r1 * img.w * img.c);
      const part = { w: img.w, h: b.r1 - b.r0, c: img.c, data: rows };
      const res = await post<Img>({ kind: 'filter', filter, params: p, img: part, ctx: { ...cleanCtx, oy: (cleanCtx.oy ?? 0) + b.r0 } }, [rows.buffer]);
      out.data.set(res.data.subarray((b.y0 - b.r0) * img.w * img.c, (b.y1 - b.r0) * img.w * img.c), b.y0 * img.w * img.c);
      onProgress?.(++done / parts.length);
    }),
  );
  return out;
}
