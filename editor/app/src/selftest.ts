// Lumora Studio's self-test (CI test builds only; see app/src/selftest/start.ts):
// the demo project (with media the CI job made, E2E_MEDIA), play, cut and
// undo, the Color page, and a 2-second export with a preset, checked with FFmpeg.

import { e2e } from '../../../app/src/e2e';
import { blur, check, click, closeDialogs, expectNoCrash, expectNoErrors, press, shows, sleep, waitFor } from '../../../app/src/selftest/dom';
import { settled } from '../../../app/src/selftest/lumora';
import type { Step } from '../../../app/src/selftest/runner';
import type { Invoke, Scenario, SelfTestConfig } from '../../../app/src/selftest/start';

/** Opens a menu at the top of the editor and picks an item (by how its label starts). */
async function menu(top: string, item: string) {
  await click('.ed__menus button.ed__menu', top);
  await click('.pop [role="menuitem"]', item, 5000);
  blur();
}

const text = (selector: string) => (document.querySelector(selector)?.textContent ?? '').trim();
const status = () => text('.ed__status');
const timecode = () => text('.tc--big');

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

export function studioSteps(cfg: SelfTestConfig, invoke: Invoke): Step[] {
  const media = cfg.media;
  const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
  return [
    {
      name: 'starts without errors (no sign-in in the test build)',
      run: async ({ log }) => {
        await shows('.start', 90_000);
        check(!document.querySelector('.gate'), 'The sign-in screen showed in the test build');
        expectNoCrash();
        expectNoErrors('start', log);
      },
    },
    {
      name: 'opens the demo project',
      run: async ({ log }) => {
        check(media, 'E2E_MEDIA (the demo media folder) is not set');
        const openDemo = e2e()?.openDemo;
        check(openDemo, 'This is not the test build (no openDemo hook)');
        openDemo(media);
        await shows('.ed', 60_000);
        await shows('.tc--big', 30_000);
        await sleep(2000);
        await closeDialogs();
        expectNoCrash();
        expectNoErrors('open demo', log);
      },
    },
    {
      name: 'plays for 2 seconds',
      run: async ({ log }) => {
        await menu('Markers', 'Mark in');
        const before = timecode();
        press(' ');
        await sleep(2000);
        press(' ');
        await sleep(500);
        const after = timecode();
        log(`timecode ${before} → ${after}`);
        check(after !== before, `The playhead did not move (${before})`);
        expectNoErrors('play', log);
      },
    },
    {
      name: 'cuts a clip at the playhead and undoes it',
      run: async ({ log }) => {
        const was = status();
        await menu('Sequence', 'Cut at the playhead');
        await waitFor(() => status() !== was, { timeout: 5000, message: `Nothing was cut (${was})` });
        const cut = status();
        await menu('Edit', 'Undo');
        await waitFor(() => status() !== cut, { timeout: 5000, message: 'Undo did nothing' });
        expectNoErrors('cut and undo', log);
      },
    },
    {
      name: 'opens the Color page',
      run: async ({ log }) => {
        await menu('View', 'Color page');
        await shows('.ed--color', 10_000);
        await sleep(1000);
        await menu('View', 'Edit page');
        await shows('.ed--edit', 10_000);
        expectNoCrash();
        expectNoErrors('color page', log);
      },
    },
    {
      name: 'exports a 2-second clip with a preset',
      timeoutMs: 8 * 60_000,
      run: async ({ log }) => {
        check(media, 'E2E_MEDIA (the demo media folder) is not set');
        const before = new Set((await invoke<VideoFile[]>('selftest_videos', { folder: media })).map((v) => v.path));
        await menu('Markers', 'Mark out');
        await menu('File', 'Export…');
        await shows('[role="dialog"][aria-label="Export"]', 10_000);
        await click('[aria-label="Presets"] button', 'YouTube 1080p (H.264)');
        await click('[aria-label="Export"] button.btn--primary', 'Export');
        const made = await waitFor(
          async () =>
            (await invoke<VideoFile[]>('selftest_videos', { folder: media })).find(
              (f) => !before.has(f.path) && /\(edited\)/.test(fileName(f.path)) && f.size > 0,
            ),
          { timeout: 300_000, interval: 2000, message: 'The export never appeared' },
        );
        await settled(invoke, media, made.path, 300_000);
        const p = await invoke<Decoded>('selftest_decode', { file: made.path });
        log(`export: ${fileName(made.path)}: ${p.frames} frames, ${p.seconds ?? '?'} s`);
        check(p.video && p.frames > 0, `The export has no frames:\n${p.text}`);
        check(p.seconds !== null && p.seconds > 0.5 && p.seconds < 5, `The export should be about 2 seconds, not ${p.seconds ?? 'unknown'}`);
        await closeDialogs().catch(() => {});
        expectNoCrash();
        expectNoErrors('export', log);
      },
    },
  ];
}

export const studioScenario: Scenario = {
  product: 'Lumora Studio',
  window: 'main',
  timeoutMs: 15 * 60_000,
  stepTimeoutMs: 3 * 60_000,
  steps: studioSteps,
};
