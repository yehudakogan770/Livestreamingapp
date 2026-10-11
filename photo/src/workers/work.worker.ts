// The heavy work, off the main thread: filters (whole or a band of rows) and
// content-aware filling.

import { runFilter } from '../core/filters/registry';
import { inpaint, type Field } from '../core/inpaint';
import type { Img } from '../core/img';
import type { FilterContext, Params } from '../core/filters/types';

interface FilterJob {
  kind: 'filter';
  id: number;
  filter: string;
  params: Params;
  img: Img;
  ctx: FilterContext;
}

interface InpaintJob {
  kind: 'inpaint';
  id: number;
  f: Field;
  hole: Uint8Array;
  valid: Uint8Array;
}

type Job = FilterJob | InpaintJob;

self.onmessage = (e: MessageEvent<Job>) => {
  const job = e.data;
  try {
    if (job.kind === 'filter') {
      const out = runFilter(job.filter, job.img, job.params, job.ctx);
      (self as unknown as Worker).postMessage({ id: job.id, ok: true, result: out }, [out.data.buffer]);
    } else {
      const out = inpaint(job.f, job.hole, job.valid);
      (self as unknown as Worker).postMessage({ id: job.id, ok: true, result: out }, [out.c.buffer]);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
