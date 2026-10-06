// The render queue's state: exports waiting, the one being made (or held),
// and the finished ones. Each change is an event; one export runs at a time.

export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'canceled';

export interface QueueJob {
  id: string;
  /** What it is: the sequence's name and the preset's. */
  name: string;
  preset: string;
  out: string;
  status: JobStatus;
  /** 0–1. */
  done: number;
  message: string;
  /** Seconds left (a guess). */
  left: number | null;
  /** The finished file. */
  path: string | null;
  added: number;
  finished: number | null;
}

export interface QueueState {
  jobs: QueueJob[];
  /** Nothing new starts (the one running carries on). */
  holding: boolean;
}

export type QueueEvent =
  | { type: 'add'; job: Pick<QueueJob, 'id' | 'name' | 'preset' | 'out'>; at: number }
  | { type: 'start'; id: string }
  | { type: 'progress'; id: string; done: number; message: string; left: number | null }
  | { type: 'pause'; id: string }
  | { type: 'resume'; id: string }
  | { type: 'cancel'; id: string }
  | { type: 'finish'; id: string; path: string | null; message: string; at: number }
  | { type: 'fail'; id: string; message: string; at: number }
  | { type: 'retry'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; by: number }
  | { type: 'clear' }
  | { type: 'hold' }
  | { type: 'release' };

export const EMPTY_QUEUE: QueueState = { jobs: [], holding: false };

/** Being made (or held part way). */
export const isActive = (j: QueueJob): boolean => j.status === 'running' || j.status === 'paused';
export const isFinished = (j: QueueJob): boolean => j.status === 'done' || j.status === 'failed' || j.status === 'canceled';

function change(s: QueueState, id: string, from: JobStatus[], f: (j: QueueJob) => QueueJob): QueueState {
  const j = s.jobs.find((x) => x.id === id);
  if (!j || !from.includes(j.status)) return s;
  return { ...s, jobs: s.jobs.map((x) => (x.id === id ? f(x) : x)) };
}

/** The queue after an event (events that don't fit the job's state change nothing). */
export function reduce(s: QueueState, e: QueueEvent): QueueState {
  switch (e.type) {
    case 'add':
      if (s.jobs.some((x) => x.id === e.job.id)) return s;
      return {
        ...s,
        jobs: [...s.jobs, { ...e.job, status: 'queued', done: 0, message: 'Waiting', left: null, path: null, added: e.at, finished: null }],
      };
    case 'start':
      if (s.jobs.some(isActive)) return s;
      return change(s, e.id, ['queued'], (j) => ({ ...j, status: 'running', message: 'Starting…', done: 0 }));
    case 'progress':
      return change(s, e.id, ['running', 'paused'], (j) => ({ ...j, done: Math.max(0, Math.min(1, e.done)), message: e.message, left: e.left }));
    case 'pause':
      return change(s, e.id, ['running'], (j) => ({ ...j, status: 'paused', left: null }));
    case 'resume':
      return change(s, e.id, ['paused'], (j) => ({ ...j, status: 'running' }));
    case 'cancel':
      return change(s, e.id, ['queued', 'running', 'paused'], (j) => ({ ...j, status: 'canceled', message: 'Canceled', left: null }));
    case 'finish':
      return change(s, e.id, ['running', 'paused'], (j) => ({ ...j, status: 'done', done: 1, path: e.path, message: e.message, left: 0, finished: e.at }));
    case 'fail':
      return change(s, e.id, ['running', 'paused'], (j) => ({ ...j, status: 'failed', message: e.message, left: null, finished: e.at }));
    case 'retry':
      return change(s, e.id, ['failed', 'canceled'], (j) => ({ ...j, status: 'queued', done: 0, message: 'Waiting', path: null, finished: null }));
    case 'remove': {
      const j = s.jobs.find((x) => x.id === e.id);
      if (!j || isActive(j)) return s;
      return { ...s, jobs: s.jobs.filter((x) => x.id !== e.id) };
    }
    case 'move': {
      const i = s.jobs.findIndex((x) => x.id === e.id);
      const to = Math.max(0, Math.min(s.jobs.length - 1, i + e.by));
      if (i < 0 || to === i) return s;
      const jobs = [...s.jobs];
      const [j] = jobs.splice(i, 1);
      if (j) jobs.splice(to, 0, j);
      return { ...s, jobs };
    }
    case 'clear':
      return { ...s, jobs: s.jobs.filter((x) => !isFinished(x)) };
    case 'hold':
      return { ...s, holding: true };
    case 'release':
      return { ...s, holding: false };
  }
}

/** The export to start now: the first waiting one, when nothing is being made and the queue isn't held. */
export function nextToRun(s: QueueState): QueueJob | null {
  if (s.holding || s.jobs.some(isActive)) return null;
  return s.jobs.find((x) => x.status === 'queued') ?? null;
}

/** How far the whole queue is along (finished and canceled ones count as done), and how many are left. */
export function overall(s: QueueState): { done: number; left: number; active: QueueJob | null } {
  const counted = s.jobs.filter((j) => j.status !== 'failed');
  const done = counted.length ? counted.reduce((a, j) => a + (isFinished(j) ? 1 : j.done), 0) / counted.length : 1;
  return { done, left: s.jobs.filter((j) => j.status === 'queued' || isActive(j)).length, active: s.jobs.find(isActive) ?? null };
}
