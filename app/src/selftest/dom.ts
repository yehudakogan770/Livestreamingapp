// What the self-test does in the page, as a person would: find a button by
// its words, click it, press a key, wait for something to show, close
// dialogs. (CI test builds only; see ./start.ts.)

import { e2e } from '../e2e';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface WaitOptions {
  timeout?: number;
  interval?: number;
  message?: string;
}

/** Waits until `check` gives something (not false, null or undefined), and returns it. */
export async function waitFor<T>(check: () => T | Promise<T>, { timeout = 15_000, interval = 200, message }: WaitOptions = {}): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  let last: unknown = null;
  for (;;) {
    try {
      const v = await check();
      if (v !== false && v !== null && v !== undefined) return v as NonNullable<T>;
    } catch (e) {
      last = e;
    }
    if (Date.now() >= end) {
      const why = last instanceof Error ? ` (${last.message})` : '';
      throw new Error(`${message ?? 'Waited too long'}${why}`);
    }
    await sleep(interval);
  }
}

export const visible = (el: Element): boolean => el.isConnected && el.getClientRects().length > 0;

const words = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The first visible element matching `selector` whose words start with `text`. */
export function findByText(selector: string, text: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (words(el).startsWith(text) && visible(el)) return el;
  }
  return null;
}

export function byText(selector: string, text: string, timeout = 15_000): Promise<HTMLElement> {
  return waitFor(() => findByText(selector, text), { timeout, message: `No "${text}" (${selector})` });
}

export async function click(selector: string, text: string, timeout?: number): Promise<HTMLElement> {
  const el = await byText(selector, text, timeout);
  if (el instanceof HTMLButtonElement && el.disabled) throw new Error(`"${text}" is turned off (disabled)`);
  el.click();
  return el;
}

/** Waits for an element to exist (and be visible). */
export function shows(selector: string, timeout = 15_000): Promise<HTMLElement> {
  return waitFor(
    () => {
      const el = document.querySelector<HTMLElement>(selector);
      return el && visible(el) ? el : null;
    },
    { timeout, message: `${selector} never showed` },
  );
}

/** Nothing has focus, so keys go to the program's shortcuts (not to a button). */
export function blur() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

const CODES: Record<string, string> = { ' ': 'Space', Enter: 'Enter', Escape: 'Escape' };

/** Presses a key (down and up) where the focus is (or on the page). */
export function press(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  const code = CODES[key] ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key);
  for (const type of ['keydown', 'keyup'] as const) {
    target.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, composed: true, ...init }));
  }
}

const DIALOGS = '[role="dialog"], .modal';

export const openDialogs = () => [...document.querySelectorAll<HTMLElement>(DIALOGS)].filter(visible);

export function waitForDialog(timeout = 10_000): Promise<HTMLElement> {
  return waitFor(() => openDialogs().at(-1) ?? null, { timeout, message: 'No dialog opened' });
}

const CLOSERS = ['Close', 'Cancel', 'Done', 'Not now', 'Skip'];

/** Closes whatever dialogs are open (Escape, then their Close or Cancel button). */
export async function closeDialogs() {
  for (let i = 0; i < 8; i++) {
    const open = openDialogs();
    if (open.length === 0) return;
    blur();
    press('Escape');
    await sleep(300);
    if (openDialogs().length < open.length) continue;
    const top = open[open.length - 1]!;
    const buttons = [...top.querySelectorAll<HTMLButtonElement>('button')].filter((b) => visible(b) && !b.disabled);
    const closer = buttons.find((b) => b.getAttribute('aria-label') === 'Close') ?? buttons.find((b) => CLOSERS.includes(words(b))) ?? null;
    closer?.click();
    await sleep(300);
  }
  if (openDialogs().length > 0) throw new Error('A dialog would not close');
}

/** Lines that are expected on a computer with no cameras, microphones or internet sign-in. */
const HARMLESS = [/NotFoundError|Requested device not found|getUserMedia|enumerateDevices/i, /Permission denied|NotAllowedError/i];

let errorsChecked = 0;

/** No new errors (console.error, uncaught errors, rejected promises) since the last check. */
export function expectNoErrors(step: string, log?: (line: string) => void) {
  const all = e2e()?.errors;
  if (!all) throw new Error('This is not the test build (no test hooks)');
  const fresh = all.slice(errorsChecked);
  errorsChecked = all.length;
  const bad = fresh.filter((e) => !HARMLESS.some((h) => h.test(e)));
  if (fresh.length !== bad.length) log?.(`${step}: ignored ${fresh.length - bad.length} device error(s)`);
  if (bad.length) throw new Error(`Errors after "${step}":\n${bad.join('\n')}`);
}

/** No screen showed "Something went wrong" (the error boundary). */
export function expectNoCrash() {
  if (document.querySelector('[data-crashed]')) throw new Error('A screen broke (the error boundary is showing)');
}

export function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
