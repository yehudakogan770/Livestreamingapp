// The last few things the app wrote to its log (the console), kept in memory
// so a problem report can say what happened just before. Each line is cleaned
// (scrub.ts) as it is kept; nothing is written to disk.

import { LIMITS, scrub } from './scrub';

export const LOG_LINES = 50;

export class LogRing {
  private lines: string[] = [];
  constructor(private readonly max = LOG_LINES) {}

  add(level: string, args: unknown[], at = new Date()): void {
    const text = args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? `${a.name}: ${a.message}` : safeJson(a))).join(' ');
    this.lines.push(`${at.toISOString().slice(11, 23)} ${level.toUpperCase().padEnd(5)} ${scrub(text, LIMITS.line)}`);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }

  recent(): string[] {
    return [...this.lines];
  }

  text(): string {
    return this.lines.join('\n');
  }
}

function safeJson(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

/** The app's log; filled once `watchConsole` has run. */
export const appLog = new LogRing();

type Level = 'log' | 'info' | 'warn' | 'error' | 'debug';
let watching = false;

/**
 * Keep a copy of every console line in `appLog` (the console still prints as
 * usual). `onError` hears console.error lines, for test builds that count them.
 */
export function watchConsole(onError?: (line: string) => void): void {
  if (watching || typeof console === 'undefined') return;
  watching = true;
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as Level[]) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        appLog.add(level, args);
        if (level === 'error') onError?.(appLog.recent().at(-1) ?? '');
      } catch {
        // Keeping the log must never break the app.
      }
      original(...args);
    };
  }
}
