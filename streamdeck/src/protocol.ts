// Talks to Lumora's remote server (src-tauri/src/remote.rs), the same way the
// phone remote does:
//
// - `GET  /api/events` (Server-Sent Events): `show` with the whole show when
//   anything changes, `app` with what is recording / streaming, and `ping`
//   every 10 seconds.
// - `POST /api/action` with one of the engine's actions (Take, CutTo…).
// - `POST /api/app` with a recording / stream / replay request.
// - `POST /api/check` to try the PIN.
//
// Every request carries the PIN in the `X-Lumora-Pin` header.

import { appState, deckState, type AppState, type DeckState, NO_APP } from './show';

export const DEFAULT_PORT = 8765;
export const DEFAULT_ADDRESS = `127.0.0.1:${DEFAULT_PORT}`;

/** offline: Lumora can't be reached; wrongPin: reached, but the PIN is wrong; off: no PIN typed yet. */
export type Connection = 'off' | 'connecting' | 'online' | 'offline' | 'wrongPin';

/** "192.168.1.20" → "http://192.168.1.20:8765" (the remote's usual port when none is given). */
export function baseUrl(address: string | undefined): string {
  let a = (address ?? '').trim() || DEFAULT_ADDRESS;
  a = a.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  if (!a) a = DEFAULT_ADDRESS;
  const hasPort = a.startsWith('[') ? /\]:\d+$/.test(a) : /:\d+$/.test(a);
  return `http://${hasPort ? a : `${a}:${DEFAULT_PORT}`}`;
}

export interface SseMessage {
  event: string;
  data: string;
}

/** Reads a Server-Sent Events stream, piece by piece as it arrives. */
export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];

  push(text: string): SseMessage[] {
    this.buffer += text;
    const out: SseMessage[] = [];
    let nl: number;
    while ((nl = this.buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buffer.slice(0, nl);
      const len = this.buffer.startsWith('\r\n', nl) ? 2 : 1;
      // A lone "\r" at the very end may be the first half of "\r\n": wait for more.
      if (len === 1 && this.buffer[nl] === '\r' && nl === this.buffer.length - 1) break;
      this.buffer = this.buffer.slice(nl + len);
      if (line === '') {
        if (this.data.length) out.push({ event: this.event || 'message', data: this.data.join('\n') });
        this.event = '';
        this.data = [];
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') this.event = value;
      else if (field === 'data') this.data.push(value);
    }
    return out;
  }
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
  now(): number;
}

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/** Waits between tries to reconnect: quick at first, then every 10 seconds. */
export const RETRY_MS = [500, 1000, 2000, 4000, 8000, 10000];
/** Lumora pings every 10 s; this long without a word means the connection is dead. */
export const SILENCE_MS = 25000;

export interface ClientOptions {
  fetch?: typeof fetch;
  timers?: Timers;
}

export interface SendResult {
  ok: boolean;
  /** Dropped because the same request was still on its way. */
  duplicate?: boolean;
  status?: number;
  error?: string;
}

type Listener = () => void;

/**
 * One connection to Lumora for the whole plugin: keeps the live updates
 * coming (reconnecting by itself), and sends actions.
 */
export class LumoraClient {
  private readonly fetch: typeof fetch;
  private readonly timers: Timers;
  private base = baseUrl(undefined);
  private pin = '';
  private generation = 0;
  private abort: AbortController | null = null;
  private retry: unknown = null;
  private watchdog: unknown = null;
  private attempt = 0;
  private show: unknown = null;
  private app: AppState = NO_APP;
  private readonly inFlight = new Set<string>();
  private readonly listeners = new Set<Listener>();

  connection: Connection = 'off';
  state: DeckState | null = null;
  /** Lumora's clock minus this computer's (Lumora sends its time with each update). */
  clockOffset = 0;

  constructor(options: ClientOptions = {}) {
    this.fetch = options.fetch ?? ((...a) => fetch(...a));
    this.timers = options.timers ?? realTimers;
  }

  /** Called whenever the state or the connection changes. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Lumora's clock now. */
  now(): number {
    return this.timers.now() + this.clockOffset;
  }

  /** Where Lumora is, and its PIN. Reconnects only when something changed. */
  configure(address: string | undefined, pin: string | undefined): void {
    const base = baseUrl(address);
    const p = (pin ?? '').trim();
    if (base === this.base && p === this.pin && this.connection !== 'off') return;
    this.base = base;
    this.pin = p;
    this.restart();
  }

  get address(): string {
    return this.base;
  }

  stop(): void {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    this.timers.clear(this.retry);
    this.timers.clear(this.watchdog);
    this.retry = this.watchdog = null;
  }

  /** Try again now (e.g. "Connect" in the settings). */
  restart(): void {
    this.stop();
    this.attempt = 0;
    if (!this.pin) {
      this.setConnection('off');
      return;
    }
    void this.connect(this.generation);
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }

  private setConnection(c: Connection): void {
    if (c === this.connection) return;
    this.connection = c;
    this.emit();
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = { 'X-Lumora-Pin': this.pin };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  private later(gen: number): void {
    if (gen !== this.generation) return;
    this.abort?.abort();
    this.timers.clear(this.watchdog);
    const wait = RETRY_MS[Math.min(this.attempt++, RETRY_MS.length - 1)]!;
    this.timers.clear(this.retry);
    this.retry = this.timers.set(() => {
      if (gen === this.generation) void this.connect(gen);
    }, wait);
  }

  private quiet(gen: number): void {
    this.timers.clear(this.watchdog);
    this.watchdog = this.timers.set(() => {
      if (gen !== this.generation) return;
      this.setConnection('offline');
      this.later(gen);
    }, SILENCE_MS);
  }

  private async connect(gen: number): Promise<void> {
    if (this.connection !== 'online' && this.connection !== 'wrongPin') this.setConnection('connecting');
    const abort = new AbortController();
    this.abort = abort;
    let res: Response;
    try {
      res = await this.fetch(`${this.base}/api/events`, { headers: this.headers(false), signal: abort.signal });
    } catch {
      if (gen !== this.generation) return;
      this.setConnection('offline');
      return this.later(gen);
    }
    if (gen !== this.generation) return;
    if (res.status === 401) {
      this.setConnection('wrongPin');
      return this.later(gen);
    }
    if (!res.ok || !res.body) {
      this.setConnection('offline');
      return this.later(gen);
    }
    const parser = new SseParser();
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    this.quiet(gen);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (gen !== this.generation) return;
        if (done) break;
        this.quiet(gen);
        for (const m of parser.push(decoder.decode(value, { stream: true }))) this.message(m);
      }
    } catch {
      // The connection dropped.
    }
    if (gen !== this.generation) return;
    this.setConnection('offline');
    this.later(gen);
  }

  /** One message from Lumora. */
  message(m: SseMessage): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(m.data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof data.now === 'number') this.clockOffset = data.now - this.timers.now();
    if (m.event === 'show') {
      const snapshot = data.snapshot as Record<string, unknown> | undefined;
      this.show = snapshot?.show ?? null;
      this.attempt = 0;
    } else if (m.event === 'app') {
      this.app = appState(data);
    } else if (m.event !== 'ping') {
      return;
    }
    if (m.event !== 'ping' || this.connection !== 'online') {
      if (this.show !== null) this.state = deckState(this.show, this.app);
      this.connection = 'online';
      this.emit();
    }
  }

  /**
   * Send a request once. The same request still on its way is not sent again
   * (a key pressed twice in a row by accident, or a slow network).
   */
  async post(path: '/api/action' | '/api/app' | '/api/check', body: unknown): Promise<SendResult> {
    const text = JSON.stringify(body ?? {});
    const key = `${path} ${text}`;
    if (this.inFlight.has(key)) return { ok: false, duplicate: true };
    if (!this.pin) return { ok: false, error: 'Type the PIN from Lumora (Settings → Phone remote).' };
    this.inFlight.add(key);
    try {
      const res = await this.fetch(`${this.base}${path}`, { method: 'POST', headers: this.headers(true), body: text });
      if (res.status === 401) this.setConnection('wrongPin');
      if (res.ok) return { ok: true, status: res.status };
      let error = `Lumora said no (${res.status}).`;
      try {
        const j = (await res.json()) as { error?: unknown; code?: unknown };
        error = typeof j.error === 'string' ? j.error : typeof j.code === 'string' ? j.code : error;
      } catch {
        // No details.
      }
      return { ok: false, status: res.status, error };
    } catch {
      return { ok: false, error: 'Lumora can’t be reached.' };
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** Run one of the engine's actions (`{ type: 'take', screen: 'live' }`…). */
  action(action: Record<string, unknown>): Promise<SendResult> {
    return this.post('/api/action', action);
  }

  /** Ask the control window: `{ command: 'record', on: true }`… */
  command(command: Record<string, unknown>): Promise<SendResult> {
    return this.post('/api/app', command);
  }
}
