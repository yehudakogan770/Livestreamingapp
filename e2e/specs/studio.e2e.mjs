// Lumora Studio (the test build): the demo project (with media the CI job
// made, E2E_MEDIA), play, cut and undo, the Color page, and a 2-second export
// with a preset, checked with FFmpeg.

import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { blur, click, closeDialogs, expectNoCrash, expectNoErrors, probe, settled, shot, videosIn, mainWindow } from '../helpers.mjs';

const media = process.env.E2E_MEDIA;

/** Opens a menu at the top of the editor and picks an item (by how its label starts). */
async function menu(top, item) {
  await click('.ed__menus button.ed__menu', top);
  await click('.pop [role="menuitem"]', item);
  await blur();
}

const status = async () => (await $('.ed__status').getText()).trim();
const timecode = async () => (await $('.tc--big').getText()).trim();

describe('Lumora Studio', () => {
  before(async () => {
    await mainWindow();
  });

  it('starts without errors (no sign-in in the test build)', async () => {
    await $('.start').waitForDisplayed({ timeout: 90_000 });
    assert.equal(await $('.gate').isExisting(), false, 'The sign-in screen showed in the test build');
    await shot('started');
    await expectNoCrash();
    await expectNoErrors('start');
  });

  it('opens the demo project', async () => {
    assert.ok(media, 'E2E_MEDIA (the demo media folder) is not set');
    await browser.execute((folder) => window.__lumoraE2E.openDemo(folder), media);
    await $('.ed').waitForDisplayed({ timeout: 60_000 });
    await $('.tc--big').waitForDisplayed({ timeout: 30_000 });
    await browser.pause(2000);
    await shot('demo-open');
    await closeDialogs();
    await expectNoCrash();
    await expectNoErrors('open demo');
  });

  it('plays for 2 seconds', async () => {
    await menu('Markers', 'Mark in');
    const before = await timecode();
    await browser.keys(' ');
    await browser.pause(2000);
    await browser.keys(' ');
    await browser.pause(500);
    const after = await timecode();
    await shot('played');
    assert.notEqual(after, before, `The playhead did not move (${before})`);
    await expectNoErrors('play');
  });

  it('cuts a clip at the playhead and undoes it', async () => {
    const was = await status();
    await menu('Sequence', 'Cut at the playhead');
    await browser.waitUntil(async () => (await status()) !== was, { timeout: 5000, timeoutMsg: `Nothing was cut (${was})` });
    const cut = await status();
    await shot('cut');
    await menu('Edit', 'Undo');
    await browser.waitUntil(async () => (await status()) !== cut, { timeout: 5000, timeoutMsg: 'Undo did nothing' });
    await shot('undone');
    await expectNoErrors('cut and undo');
  });

  it('opens the Color page', async () => {
    await menu('View', 'Color page');
    await $('.ed--color').waitForExist({ timeout: 10_000 });
    await browser.pause(1000);
    await shot('color-page');
    await menu('View', 'Edit page');
    await $('.ed--edit').waitForExist({ timeout: 10_000 });
    await expectNoCrash();
    await expectNoErrors('color page');
  });

  it('exports a 2-second clip with a preset', async () => {
    const before = new Set(videosIn(media));
    await menu('Markers', 'Mark out');
    await menu('File', 'Export…');
    const dialog = await $('[role="dialog"][aria-label="Export"]');
    await dialog.waitForDisplayed();
    await click('[aria-label="Presets"] button', 'YouTube 1080p (H.264)');
    await shot('export-dialog');
    await click('[aria-label="Export"] button.btn--primary', 'Export');
    let made = null;
    await browser.waitUntil(
      async () => {
        made = videosIn(media).find((f) => !before.has(f) && /\(edited\)/.test(basename(f)));
        return !!made && statSync(made).size > 0;
      },
      { timeout: 300_000, interval: 2000, timeoutMsg: 'The export never appeared' },
    );
    await settled(made, 300_000);
    await shot('exported');
    const p = probe(made);
    console.log(`export: ${basename(made)}: ${p.frames} frames, ${p.seconds} s`);
    assert.ok(p.video && p.frames > 0, `The export has no frames:\n${p.text}`);
    assert.ok(p.seconds > 0.5 && p.seconds < 5, `The export should be about 2 seconds, not ${p.seconds}`);
    await closeDialogs().catch(() => {});
    await expectNoCrash();
    await expectNoErrors('export');
  });
});
