// Making playback proxies: several side by side (as many as the processor
// has room for, each with its share of the cores), the files under or nearest
// the playhead first, and the ones asked for by hand ("Generate proxies for
// selection") before everything else.
import { current, end, mediaOf } from '../model/seq';
import type { Project } from '../model/types';

export interface ProxyJob {
  id: string;
  path: string;
  /** Asked for by hand: made before the rest. */
  urgent?: boolean;
}

/** How many proxies are made at once on a computer with `cores` logical cores (each FFmpeg uses several). */
export function proxySlots(cores: number): number {
  const n = Math.floor((Number.isFinite(cores) && cores > 0 ? cores : 4) / 4);
  return Math.max(1, Math.min(4, n));
}

/** FFmpeg threads for each proxy made at once. */
export function threadsFor(cores: number, slots: number): number {
  return Math.max(1, Math.floor((cores > 0 ? cores : 4) / Math.max(1, slots)));
}

/** Frames from the playhead to the nearest place the open sequence shows a file (0 under the playhead; Infinity when unused there). */
export function mediaDistance(p: Project, mediaId: string, playhead: number): number {
  const s = current(p);
  let best = Infinity;
  for (const c of s.clips) {
    if (mediaOf(p, c)?.id !== mediaId) continue;
    const d = playhead < c.start ? c.start - playhead : playhead >= end(c) ? playhead - end(c) + 1 : 0;
    // Behind the playhead counts double: playback goes forward.
    const w = playhead >= end(c) ? d * 2 : d;
    if (w < best) best = w;
  }
  return best;
}

/** The job to start next: asked-for first, then nearest the playhead, then the rest in the order they came. */
export function nextJob(jobs: ProxyJob[], p: Project | null, playhead: number): ProxyJob | undefined {
  let best: ProxyJob | undefined;
  let bestScore = Infinity;
  jobs.forEach((j, i) => {
    const d = p ? mediaDistance(p, j.id, playhead) : Infinity;
    // Urgent ones before all; unused files after used ones, in order.
    const score = (j.urgent ? 0 : 1e12) + (Number.isFinite(d) ? d : 1e9 + i);
    if (score < bestScore) {
      bestScore = score;
      best = j;
    }
  });
  return best;
}

/** Runs proxy jobs a few at a time, always picking the most useful next. */
export class ProxyScheduler {
  private waiting: ProxyJob[] = [];
  private running = new Set<string>();
  readonly slots: number;
  readonly threads: number;
  constructor(
    private run: (job: ProxyJob, threads: number) => Promise<void>,
    private focus: () => { p: Project | null; playhead: number },
    cores: number,
  ) {
    this.slots = proxySlots(cores);
    this.threads = threadsFor(cores, this.slots);
  }

  get busy(): number {
    return this.running.size;
  }
  get queued(): number {
    return this.waiting.length;
  }

  /** Is this file waiting or being made? */
  has(id: string): boolean {
    return this.running.has(id) || this.waiting.some((j) => j.id === id);
  }

  add(jobs: ProxyJob[]) {
    for (const j of jobs) {
      const had = this.waiting.find((w) => w.id === j.id);
      if (had) {
        if (j.urgent) had.urgent = true;
        continue;
      }
      if (!this.running.has(j.id)) this.waiting.push(j);
    }
    this.pump();
  }

  private pump() {
    while (this.running.size < this.slots && this.waiting.length) {
      const f = this.focus();
      const job = nextJob(this.waiting, f.p, f.playhead);
      if (!job) return;
      this.waiting = this.waiting.filter((j) => j !== job);
      this.running.add(job.id);
      void this.run(job, this.threads)
        .catch(() => undefined)
        .finally(() => {
          this.running.delete(job.id);
          this.pump();
        });
    }
  }
}
