// Error reports and "Report a problem", for Lumora and Lumora Studio.
//
// - Errors nobody caught (in the screens, and crashes of the program itself)
//   are sent only if the person said yes (consent.ts), cleaned (scrub.ts),
//   a few at a time (queue.ts).
// - "Report a problem" is always the person's own choice: what they wrote,
//   and the picture and log lines only if they leave them in.
// Both go to the problem_reports table (supabase/update-3-reports.sql), which
// only the Lumora team can read. Never the show, the project or its files.

import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { authOn } from '../auth/config';
import { supabase } from '../auth/auth';
import { e2e, TEST_BUILD } from '../e2e';
import { mayAutoSend, readConsent } from './consent';
import { appLog, watchConsole } from './logs';
import { ReportQueue, type AppName, type ReportKind, type ReportRow } from './queue';
import { fingerprint, LIMITS, scrub } from './scrub';

const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let appName: AppName = 'lumora';
let version = 'unknown';
let installed = false;

/** The computer, in general terms (from the web view: e.g. "Windows NT 10.0; Win64; x64 · Edg/131"). */
export function osName(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const sys = /\(([^)]+)\)/.exec(ua)?.[1] ?? 'unknown';
  // WebView2 says Chrome and Edg: Edg is the one that matters.
  const engine = /\b(Edg)\/(\d+)/.exec(ua) ?? /\b(Chrome|Firefox|Safari)\/(\d+)/.exec(ua);
  return scrub(engine ? `${sys} · ${engine[1]}/${engine[2]}` : sys, 120);
}

/** A report row, cleaned. */
export function makeRow(
  kind: ReportKind,
  error: unknown,
  extra: { stack?: string; logs?: string; description?: string; screenshot?: string | null } = {},
): ReportRow {
  const err = error instanceof Error ? error : null;
  const message = scrub(err ? `${err.name}: ${err.message}` : error, LIMITS.message);
  return {
    kind,
    app: appName,
    version,
    os: osName(),
    message,
    stack: scrub(extra.stack ?? err?.stack ?? '', LIMITS.stack),
    logs: extra.logs ?? appLog.text(),
    fingerprint: fingerprint(appName, message),
    ...(extra.description !== undefined ? { description: scrub(extra.description, LIMITS.description) } : {}),
    ...(extra.screenshot !== undefined ? { screenshot: extra.screenshot } : {}),
  };
}

/** Sends rows to the server (signed-in people only). */
async function send(rows: ReportRow[]): Promise<void> {
  if (TEST_BUILD) return;
  if (!authOn()) throw new Error('There is no Lumora account server set up.');
  const { data } = await supabase().auth.getSession();
  if (!data.session) throw new Error('Sign in first.');
  const { error } = await supabase().from('problem_reports').insert(rows);
  if (error) throw new Error(error.message);
}

const queue = new ReportQueue({ send });

/** Something went wrong that nobody caught: kept for the log, sent if the person agreed. */
export function reportError(error: unknown, kind: ReportKind = 'error', stack?: string): void {
  try {
    const hooks = e2e();
    if (hooks) hooks.errors.push(scrub(error instanceof Error ? `${error.name}: ${error.message}` : error, LIMITS.line));
    if (!mayAutoSend(readConsent())) return;
    queue.add(makeRow(kind, error, stack !== undefined ? { stack } : {}));
  } catch {
    // Reporting must never be the next problem.
  }
}

/** React's "a screen broke" (createRoot's onCaughtError/onUncaughtError). */
export function reactError(error: unknown, info: { componentStack?: string | undefined }): void {
  console.error('Lumora: a screen broke', error);
  const stack = `${error instanceof Error ? (error.stack ?? '') : ''}\n${info.componentStack ?? ''}`;
  reportError(error, 'error', stack);
}

/**
 * Start listening for errors in this window (once, first thing). The console
 * keeps its last lines for reports from now on.
 */
export function installErrorReporting(app: AppName): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  appName = app;
  watchConsole(TEST_BUILD ? (line) => e2e()?.errors.push(line) : undefined);
  window.addEventListener('error', (e) => {
    // A picture or script that would not load also lands here, without an error: leave those.
    if (e.error === undefined && !e.message) return;
    reportError(e.error ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason ?? 'A promise was rejected'));
  if (inApp())
    void getVersion()
      .then((v) => (version = v))
      .catch(() => {});
  else version = 'browser';
}

/** Crashes of the program itself since last time (kept by the Rust side): sent if agreed, else dropped. */
export async function collectCrashReports(): Promise<void> {
  if (!inApp()) return;
  let crashes: { message: string; location: string; thread: string; version: string; at: number }[] = [];
  try {
    crashes = await invoke('take_crash_reports');
  } catch {
    return;
  }
  for (const c of crashes) {
    if (!mayAutoSend(readConsent())) continue;
    const row = makeRow('crash', `The program stopped: ${c.message}`, {
      stack: `${c.location} (thread ${c.thread}) at ${new Date(c.at).toISOString()}`,
      logs: '',
    });
    queue.add({ ...row, version: c.version || row.version });
  }
}

const manualSent: number[] = [];
/** At most this many "Report a problem" sends an hour. */
export const MANUAL_PER_HOUR = 5;

/** "Report a problem": sent now (the person's own choice; no consent needed). */
export async function sendProblemReport(r: { description: string; screenshot: string | null; logs: boolean }, now = Date.now()): Promise<void> {
  const recent = manualSent.filter((t) => now - t < 3_600_000);
  if (recent.length >= MANUAL_PER_HOUR) throw new Error('That is a lot of reports in one hour. Please wait a little and try again.');
  const description = r.description.trim();
  if (!description) throw new Error('Write a few words about what happened first.');
  const row = makeRow('report', description.split('\n')[0]!.slice(0, 200), {
    description,
    screenshot: r.screenshot,
    logs: r.logs ? appLog.text() : '',
    stack: '',
  });
  await send([{ ...row, fingerprint: `${appName}:report` }]);
  manualSent.splice(0, manualSent.length, ...recent, now);
}
