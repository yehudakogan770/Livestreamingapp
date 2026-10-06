// Lumora's self-test (CI test builds only; see ./start.ts): starts clean,
// inputs, TAKE, every main dialog, and a rehearsal recording to a temporary
// folder, checked with FFmpeg.

import type { CaptureSettings, ShowSnapshot } from '../engine/client';
import type { Show } from '../engine/types/Show';
import { blur, check, click, closeDialogs, expectNoCrash, expectNoErrors, press, shows, sleep, waitFor, waitForDialog } from './dom';
import type { Invoke, Scenario } from './start';
import type { Step } from './runner';

/** The main dialogs, from their menus: [menu, item]. */
export const DIALOGS: [string, string][] = [
  ['Event', 'Event setup…'],
  ['Event', 'Event look (branding)…'],
  ['Event', 'New event'],
  ['Presets', 'Add a preset…'],
  ['Cues', 'Run of show…'],
  ['Cues', 'Triggers'],
  ['Library', 'Open the library…'],
  ['Inputs', 'Add input…'],
  ['Overlays', 'Set up overlays…'],
  ['Text', 'Live chat and audience questions…'],
  ['Text', 'Data file (spreadsheet)…'],
  ['Visuals', 'Stage visuals…'],
  ['Settings', 'Recording and streaming…'],
  ['Settings', 'Speaker names…'],
  ['Settings', 'Live captions…'],
  ['Settings', 'Phone remote…'],
  ['Settings', 'MIDI controller…'],
  ['Help', 'How to use Lumora'],
  ['Help', 'Keyboard shortcuts'],
  ['Help', 'Report a problem…'],
];

/** Opens a title bar menu and picks an item (by how its label starts). */
async function menu(top: string, item: string) {
  await click('.titlebar__menu button.titlebar__item', top);
  await click(`.titlebar__drop[aria-label="${top}"] [role="menuitem"]`, item, 5000);
}

interface VideoFile {
  path: string;
  size: number;
}

interface Decoded {
  frames: number;
  seconds: number | null;
  video: boolean;
  ok: boolean;
  text: string;
}

/** Waits until a file stops growing. */
export async function settled(invoke: Invoke, folder: string, path: string, timeout = 120_000) {
  let last = -1;
  await waitFor(
    async () => {
      const f = (await invoke<VideoFile[]>('selftest_videos', { folder })).find((v) => v.path === path);
      const same = !!f && f.size > 0 && f.size === last;
      last = f?.size ?? -1;
      return same;
    },
    { timeout, interval: 2000, message: `${path} kept changing` },
  );
}

export function lumoraSteps(invoke: Invoke): Step[] {
  const show = async () => (await invoke<ShowSnapshot>('get_show')).show;
  const sourceOf = (s: Show, type: string) => s.sources.find((x) => x.kind.type === type);
  return [
    {
      name: 'starts without errors (no sign-in in the test build)',
      run: async ({ log }) => {
        await shows('.titlebar', 90_000);
        await waitFor(() => !document.querySelector('.workarea .loading'), { timeout: 60_000, message: 'The show never loaded' });
        check(!document.querySelector('.gate'), 'The sign-in screen showed in the test build');
        // The event setup opens by itself the first time.
        await sleep(1500);
        await closeDialogs();
        expectNoCrash();
        expectNoErrors('start', log);
      },
    },
    {
      name: 'adds a Color input and a Countdown',
      run: async ({ log }) => {
        for (const kind of ['Color', 'Countdown']) {
          await menu('Inputs', 'Add input…');
          await shows('[role="dialog"][aria-label="Add input"]', 10_000);
          await click('[aria-label="Add input"] button.addinput__kind', kind);
          await click('[aria-label="Add input"] .modal__foot button.btn--primary', 'Add input');
          await waitFor(() => !document.querySelector('[role="dialog"][aria-label="Add input"]'), {
            timeout: 10_000,
            message: `The Add input dialog stayed open (${kind})`,
          });
        }
        const s = await show();
        check(sourceOf(s, 'color'), 'No Color input in the show');
        check(sourceOf(s, 'countdown'), 'No Countdown input in the show');
        log(`${s.sources.length} inputs`);
        expectNoErrors('add inputs', log);
      },
    },
    {
      name: 'puts the Color input in Next and TAKEs it to air',
      run: async ({ log }) => {
        const color = sourceOf(await show(), 'color');
        check(color, 'No Color input in the show');
        const tile = await waitFor(
          () => [...document.querySelectorAll<HTMLButtonElement>('button.tile__pick')].find((t) => t.getAttribute('aria-label')?.endsWith(` ${color.name}`)),
          { timeout: 10_000, message: `No tile for "${color.name}"` },
        );
        tile.click();
        await waitFor(async () => (await show()).screens.live.preview === color.id, { timeout: 10_000, message: 'Color did not go to Next' });
        const take = document.querySelector<HTMLButtonElement>('button.switch__take');
        if (take) take.click();
        else {
          blur();
          press('Enter');
        }
        await waitFor(async () => (await show()).screens.live.program === color.id, { timeout: 10_000, message: 'TAKE did not put Color on air' });
        await sleep(1000);
        expectNoCrash();
        expectNoErrors('take', log);
      },
    },
    {
      name: 'opens and closes every main dialog',
      timeoutMs: 6 * 60_000,
      run: async ({ log }) => {
        const missing: string[] = [];
        for (const [top, item] of DIALOGS) {
          try {
            await menu(top, item);
            await waitForDialog();
            await sleep(400);
            await closeDialogs();
            log(`dialog ok: ${top} → ${item}`);
          } catch (e) {
            missing.push(`${top} → ${item}: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`);
            await closeDialogs().catch(() => {});
          }
        }
        expectNoCrash();
        check(missing.length === 0, `Dialogs that did not open or close:\n${missing.join('\n')}`);
        expectNoErrors('dialogs', log);
      },
    },
    {
      name: 'records a rehearsal to a temporary file and stops it',
      timeoutMs: 6 * 60_000,
      run: async ({ log }) => {
        const folder = await invoke<string>('selftest_temp_folder', { name: 'rec' });
        const settings = await invoke<CaptureSettings>('capture_settings');
        await invoke('set_capture_settings', { settings: { ...settings, folder } });
        log(`recording to ${folder}`);
        // Rehearsal: nothing is sent anywhere.
        const rehearsal = await click('button.bc-btn', 'Rehearsal');
        await waitFor(() => rehearsal.getAttribute('aria-pressed') === 'true', { timeout: 5000, message: 'Rehearsal did not turn on' });
        const rec = await click('button.bc-btn', 'REC');
        await waitFor(() => /^REC \d/.test((rec.textContent ?? '').trim()), { timeout: 30_000, message: 'Recording did not start' });
        await sleep(4000);
        rec.click();
        await click('[role="dialog"] button', 'Stop recording');
        await shows('.bc-saved', 90_000);
        const files = await waitFor(
          async () => {
            const v = await invoke<VideoFile[]>('selftest_videos', { folder });
            return v.length ? v : null;
          },
          { timeout: 30_000, message: `No recording in ${folder}` },
        );
        const main = files[0]!.path;
        await settled(invoke, folder, main);
        const p = await invoke<Decoded>('selftest_decode', { file: main });
        check(p.video && p.frames > 0, `The recording has no frames:\n${p.text}`);
        log(`recording: ${p.frames} frames, ${p.seconds ?? '?'} s`);
        rehearsal.click();
        await closeDialogs().catch(() => {});
        expectNoCrash();
        expectNoErrors('recording', log);
      },
    },
  ];
}

export const lumoraScenario: Scenario = {
  product: 'Lumora',
  window: 'control',
  timeoutMs: 12 * 60_000,
  stepTimeoutMs: 3 * 60_000,
  steps: (_cfg, invoke) => lumoraSteps(invoke),
};
