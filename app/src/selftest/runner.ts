// The end-to-end self-test's runner (CI test builds only; see ./start.ts).
// Runs a scenario's steps one after another, records each one's result
// (passed or failed, with the reason, and how long it took), and never lets a
// step, or the whole scenario, run on forever.

/** Marks the self-test code: the shipped-build test looks for it in the built screens. */
export const SELFTEST_MARK = 'lumora-selftest-runner';

export interface StepContext {
  /** A line for the run's log (kept with the results). */
  log: (line: string) => void;
}

export interface Step {
  name: string;
  run: (ctx: StepContext) => Promise<void> | void;
  /** This step's own limit (default: the scenario's step limit). */
  timeoutMs?: number;
}

export interface StepResult {
  name: string;
  ok: boolean;
  /** Not run (the scenario ran out of time first). */
  skipped?: boolean;
  /** How long it took, ms. */
  ms: number;
  /** Why it failed. */
  message?: string;
}

export interface SelfTestResults {
  mark: typeof SELFTEST_MARK;
  product: string;
  ok: boolean;
  /** When it started (ISO time). */
  startedAt: string;
  ms: number;
  steps: StepResult[];
  passed: number;
  failed: number;
  log: string[];
  /** The scenario itself went wrong (not a step). */
  error?: string;
}

export interface RunOptions {
  /** The whole scenario's limit, ms. */
  timeoutMs: number;
  /** Each step's limit, ms (default: what is left of the scenario's). */
  stepTimeoutMs?: number;
  now?: () => number;
  /** Also print the log (the browser console). */
  echo?: (line: string) => void;
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** `work`, or a TimeoutError after `ms`. */
export function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), Math.max(0, ms));
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** An error's message, in one line or a few. */
export function describe(e: unknown): string {
  const text = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
  return (text || String(e)).slice(0, 2000);
}

/** Runs the steps in order. Never throws; a failed step doesn't stop the next. */
export async function runScenario(product: string, steps: Step[], opts: RunOptions): Promise<SelfTestResults> {
  const now = opts.now ?? (() => Date.now());
  const start = now();
  const log: string[] = [];
  const say = (line: string) => {
    const at = ((now() - start) / 1000).toFixed(1).padStart(6);
    const entry = `${at}s ${line}`;
    log.push(entry);
    opts.echo?.(entry);
  };
  const results: StepResult[] = [];
  for (const step of steps) {
    const left = opts.timeoutMs - (now() - start);
    if (left <= 0) {
      results.push({ name: step.name, ok: false, skipped: true, ms: 0, message: 'Not run: the scenario ran out of time' });
      say(`SKIP ${step.name}`);
      continue;
    }
    const limit = Math.min(step.timeoutMs ?? opts.stepTimeoutMs ?? left, left);
    const began = now();
    say(`START ${step.name}`);
    try {
      await withTimeout(
        Promise.resolve().then(() => step.run({ log: say })),
        limit,
        `Timed out after ${(limit / 1000).toFixed(1)} s`,
      );
      results.push({ name: step.name, ok: true, ms: now() - began });
      say(`PASS ${step.name}`);
    } catch (e) {
      const message = describe(e);
      results.push({ name: step.name, ok: false, ms: now() - began, message });
      say(`FAIL ${step.name}: ${message}`);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  return {
    mark: SELFTEST_MARK,
    product,
    ok: failed === 0 && results.length > 0,
    startedAt: new Date(start).toISOString(),
    ms: now() - start,
    steps: results,
    passed: results.length - failed,
    failed,
    log,
  };
}
