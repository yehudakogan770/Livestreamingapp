// Shared steps for the end-to-end specs (browser, $ and $$ are WebdriverIO's).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.env.E2E_OUT ?? 'results');
const name = process.env.E2E_NAME ?? 'e2e';
let shots = 0;

/** A numbered picture of the window, kept with the results. */
export async function shot(step) {
  shots += 1;
  const file = join(out, `${name}-${String(shots).padStart(2, '0')}-${step.replace(/[^\w]+/g, '-')}.png`);
  await browser.saveScreenshot(file).catch((e) => console.warn(`screenshot ${step}: ${e.message}`));
}

/**
 * Switch to the program's main window (not the loading window, an output
 * screen or a web page input), waiting for it to exist.
 */
export async function mainWindow(timeout = 90_000) {
  await browser.waitUntil(
    async () => {
      for (const h of await browser.getWindowHandles()) {
        try {
          await browser.switchToWindow(h);
          const url = await browser.getUrl();
          const output = await browser.execute(() => {
            const label = window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? '';
            return label.startsWith('output-') || label.startsWith('page-') || label === 'splash';
          });
          if (!/splash\.html/.test(url) && !output) return true;
        } catch {
          // A window that closed while looking (the loading window): try the next.
        }
      }
      return false;
    },
    { timeout, interval: 1000, timeoutMsg: 'The main window never opened' },
  );
}

/** Calls the program's own Rust side (as its screens do). */
export async function invoke(cmd, args = {}) {
  const r = await browser.execute(
    (cmd, args) =>
      window.__TAURI_INTERNALS__.invoke(cmd, args).then(
        (ok) => ({ ok }),
        (err) => ({ err: String(err?.message ?? err) }),
      ),
    cmd,
    args,
  );
  if (r && 'err' in r) throw new Error(`${cmd}: ${r.err}`);
  return r?.ok;
}

/** Errors the test build saw (console.error, uncaught errors, rejected promises). */
export async function errorsSeen() {
  return browser.execute(() => window.__lumoraE2E?.errors ?? null);
}

/** Lines that are expected on a computer with no cameras, microphones or internet sign-in. */
const HARMLESS = [/NotFoundError|Requested device not found|getUserMedia|enumerateDevices/i, /Permission denied|NotAllowedError/i];

export async function expectNoErrors(step) {
  const errors = await errorsSeen();
  assert.ok(Array.isArray(errors), 'This is not the test build (no window.__lumoraE2E)');
  const bad = errors.filter((e) => !HARMLESS.some((h) => h.test(e)));
  if (errors.length !== bad.length) console.warn(`${step}: ignored ${errors.length - bad.length} device error(s)`);
  assert.deepEqual(bad, [], `Errors after "${step}":\n${bad.join('\n')}`);
}

/** No screen showed "Something went wrong" (the error boundary). */
export async function expectNoCrash() {
  const crashed = await $$('[data-crashed]');
  assert.equal(crashed.length, 0, 'A screen broke (the error boundary is showing)');
}

/** The first visible element matching `selector` whose text starts with `text`. */
export async function byText(selector, text, timeout = 15_000) {
  let found = null;
  await browser.waitUntil(
    async () => {
      for (const el of await $$(selector)) {
        const t = (await el.getText().catch(() => '')).trim();
        if (t.startsWith(text) && (await el.isDisplayed().catch(() => false))) {
          found = el;
          return true;
        }
      }
      return false;
    },
    { timeout, interval: 300, timeoutMsg: `No "${text}" (${selector})` },
  );
  return found;
}

export async function click(selector, text, timeout) {
  const el = await byText(selector, text, timeout);
  await el.click();
  return el;
}

const dialogs = '[role="dialog"], .modal';

/** Waits for a dialog to be open. */
export async function waitForDialog(timeout = 10_000) {
  await browser.waitUntil(async () => (await $$(dialogs)).length > 0, { timeout, interval: 250, timeoutMsg: 'No dialog opened' });
}

/** Closes whatever dialogs are open (Escape, then their Close or Cancel button). */
export async function closeDialogs() {
  for (let i = 0; i < 6; i++) {
    const open = await $$(dialogs);
    if (open.length === 0) return;
    await browser.keys('Escape');
    await browser.pause(300);
    if ((await $$(dialogs)).length < open.length) continue;
    const top = open[open.length - 1];
    for (const sel of ['button[aria-label="Close"]', 'button=Close', 'button=Cancel', 'button=Done', 'button=Not now', 'button=Skip']) {
      const b = await top.$(sel);
      if ((await b.isExisting()) && (await b.isDisplayed())) {
        await b.click();
        break;
      }
    }
    await browser.pause(300);
  }
  assert.equal((await $$(dialogs)).length, 0, 'A dialog would not close');
}

/** Nothing has focus, so keys go to the app's shortcuts (not to a button). */
export async function blur() {
  await browser.execute(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
}

/** Video files in a folder (and below). */
export function videosIn(folder) {
  const found = [];
  for (const f of readdirSync(folder, { recursive: true })) {
    const p = join(folder, String(f));
    if (/\.(webm|mp4|mov|mkv)$/i.test(p) && statSync(p).isFile()) found.push(p);
  }
  return found;
}

/** Waits until a file stops growing. */
export async function settled(file, timeout = 120_000) {
  let last = -1;
  await browser.waitUntil(
    async () => {
      const size = statSync(file).size;
      const same = size > 0 && size === last;
      last = size;
      return same;
    },
    { timeout, interval: 2000, timeoutMsg: `${file} kept changing` },
  );
}

/**
 * What FFmpeg reads in a file: its length and how many video frames
 * (it decodes the whole file, so a broken one fails here).
 */
export function probe(file) {
  const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-map', '0:v:0', '-f', 'null', '-'], { encoding: 'utf8' });
  const text = `${r.stderr ?? ''}`;
  const frames = [...text.matchAll(/frame=\s*(\d+)/g)].map((m) => Number(m[1])).pop() ?? 0;
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(text);
  const seconds = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : NaN;
  return { frames, seconds, video: /Stream #.*Video:/.test(text), ok: r.status === 0, text: text.slice(-1500) };
}
