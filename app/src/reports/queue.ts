// Error reports wait a moment and go out together, a few at a time: the same
// problem is sent once (not a thousand times from a loop), and a computer
// that goes wrong in a big way can't flood the server.

export type AppName = 'lumora' | 'studio';
export type ReportKind = 'error' | 'crash' | 'report';

/** One row of the problem_reports table (see supabase/update-3-reports.sql). */
export interface ReportRow {
  kind: ReportKind;
  app: AppName;
  version: string;
  os: string;
  message: string;
  stack: string;
  logs: string;
  fingerprint: string;
  description?: string;
  screenshot?: string | null;
}

export interface QueueOptions {
  send: (rows: ReportRow[]) => Promise<void>;
  now?: () => number;
  /** Timers (replaceable in tests). */
  later?: (f: () => void, ms: number) => void;
  /** Wait this long after the first report before sending, to gather others. */
  batchMs?: number;
  /** At most this many in one send. */
  maxBatch?: number;
  /** At most `perWindow` reports in any `windowMs`. */
  perWindow?: number;
  windowMs?: number;
  /** The same problem again within this time is not sent again. */
  repeatMs?: number;
  /** Waiting reports kept while offline (the oldest go first). */
  maxPending?: number;
  /** A send that fails is tried again after this long, up to `tries` times. */
  retryMs?: number;
  tries?: number;
}

export type AddResult = 'queued' | 'duplicate' | 'limited';

interface Pending {
  row: ReportRow;
  tries: number;
}

export class ReportQueue {
  private readonly o: Required<QueueOptions>;
  private pending: Pending[] = [];
  private accepted: number[] = [];
  private seen = new Map<string, number>();
  private timer = false;
  private sending = false;

  constructor(options: QueueOptions) {
    this.o = {
      now: () => Date.now(),
      later: (f, ms) => void setTimeout(f, ms),
      batchMs: 5_000,
      maxBatch: 10,
      perWindow: 10,
      windowMs: 10 * 60_000,
      repeatMs: 60 * 60_000,
      maxPending: 50,
      retryMs: 60_000,
      tries: 3,
      ...options,
    };
  }

  /** Reports waiting to go. */
  get size(): number {
    return this.pending.length;
  }

  add(row: ReportRow): AddResult {
    const now = this.o.now();
    const last = this.seen.get(row.fingerprint);
    if (last !== undefined && now - last < this.o.repeatMs) return 'duplicate';
    this.accepted = this.accepted.filter((t) => now - t < this.o.windowMs);
    if (this.accepted.length >= this.o.perWindow) return 'limited';
    this.accepted.push(now);
    this.seen.set(row.fingerprint, now);
    if (this.seen.size > 500) this.seen = new Map([...this.seen].filter(([, t]) => now - t < this.o.repeatMs));
    this.pending.push({ row, tries: 0 });
    if (this.pending.length > this.o.maxPending) this.pending.splice(0, this.pending.length - this.o.maxPending);
    if (this.pending.length >= this.o.maxBatch) void this.flush();
    else this.schedule(this.o.batchMs);
    return 'queued';
  }

  /** Send what is waiting now (one batch). */
  async flush(): Promise<void> {
    if (this.sending || this.pending.length === 0) return;
    this.sending = true;
    const batch = this.pending.splice(0, this.o.maxBatch);
    try {
      await this.o.send(batch.map((p) => p.row));
    } catch {
      // Offline or refused: those still worth trying go back to the front.
      const again = batch.filter((p) => ++p.tries < this.o.tries);
      this.pending.unshift(...again);
      if (this.pending.length) this.schedule(this.o.retryMs);
      return;
    } finally {
      this.sending = false;
    }
    if (this.pending.length) this.schedule(this.o.batchMs);
  }

  private schedule(ms: number): void {
    if (this.timer) return;
    this.timer = true;
    this.o.later(() => {
      this.timer = false;
      void this.flush();
    }, ms);
  }
}
