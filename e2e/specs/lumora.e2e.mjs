// Lumora (the test build): starts clean, inputs, TAKE, every main dialog, and
// a rehearsal recording to a temporary folder.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blur, click, closeDialogs, expectNoCrash, expectNoErrors, invoke, mainWindow, probe, settled, shot, videosIn, waitForDialog } from '../helpers.mjs';

/** Opens a title bar menu and picks an item (by how its label starts). */
async function menu(top, item) {
  await click('.titlebar__menu button.titlebar__item', top);
  await click(`.titlebar__drop[aria-label="${top}"] [role="menuitem"]`, item);
}

const show = async () => (await invoke('get_show')).show;

/** The main dialogs, from their menus. */
const DIALOGS = [
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

describe('Lumora', () => {
  before(async () => {
    await mainWindow();
  });

  it('starts without errors (no sign-in in the test build)', async () => {
    await $('.titlebar').waitForDisplayed({ timeout: 90_000 });
    // The engine answered and the show is there.
    await browser.waitUntil(async () => !(await $('.workarea .loading').isExisting()), { timeout: 60_000, timeoutMsg: 'The show never loaded' });
    assert.equal(await $('.gate').isExisting(), false, 'The sign-in screen showed in the test build');
    await shot('started');
    // The event setup opens by itself the first time.
    await closeDialogs();
    await expectNoCrash();
    await expectNoErrors('start');
  });

  it('adds a Color input and a Countdown', async () => {
    for (const kind of ['Color', 'Countdown']) {
      await menu('Inputs', 'Add input…');
      const dialog = await $('[role="dialog"][aria-label="Add input"]');
      await dialog.waitForDisplayed();
      await click('[aria-label="Add input"] button.addinput__kind', kind);
      await shot(`add-${kind}`);
      await click('[aria-label="Add input"] .modal__foot button.btn--primary', 'Add input');
      await dialog.waitForExist({ reverse: true, timeout: 10_000 });
    }
    const s = await show();
    assert.ok(
      s.sources.some((x) => x.kind.type === 'color'),
      'No Color input in the show',
    );
    assert.ok(
      s.sources.some((x) => x.kind.type === 'countdown'),
      'No Countdown input in the show',
    );
    await shot('inputs-added');
    await expectNoErrors('add inputs');
  });

  it('puts the Color input in Next and TAKEs it to air', async () => {
    const color = (await show()).sources.find((x) => x.kind.type === 'color');
    const tiles = await $$('button.tile__pick');
    let tile = null;
    for (const t of tiles) if ((await t.getAttribute('aria-label'))?.endsWith(` ${color.name}`)) tile = t;
    assert.ok(tile, `No tile for "${color.name}"`);
    await tile.click();
    await browser.waitUntil(async () => (await show()).screens.live.preview === color.id, { timeout: 10_000, timeoutMsg: 'Color did not go to Next' });
    const take = await $('button.switch__take');
    if (await take.isExisting()) await take.click();
    else {
      await blur();
      await browser.keys('Enter');
    }
    await browser.waitUntil(async () => (await show()).screens.live.program === color.id, { timeout: 10_000, timeoutMsg: 'TAKE did not put Color on air' });
    await browser.pause(1000);
    await shot('on-air');
    await expectNoCrash();
    await expectNoErrors('take');
  });

  it('opens and closes every main dialog', async () => {
    const missing = [];
    for (const [top, item] of DIALOGS) {
      try {
        await menu(top, item);
        await waitForDialog();
        await browser.pause(500);
        await shot(`dialog-${item}`);
        await closeDialogs();
      } catch (e) {
        missing.push(`${top} → ${item}: ${e.message.split('\n')[0]}`);
        await shot(`dialog-FAILED-${item}`);
        await closeDialogs().catch(() => {});
      }
    }
    await expectNoCrash();
    assert.deepEqual(missing, [], `Dialogs that did not open or close:\n${missing.join('\n')}`);
    await expectNoErrors('dialogs');
  });

  it('records a rehearsal to a temporary file and stops it', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'lumora-e2e-rec-'));
    const settings = await invoke('capture_settings');
    await invoke('set_capture_settings', { settings: { ...settings, folder } });
    // Rehearsal: nothing is sent anywhere.
    const rehearsal = await click('button.bc-btn', 'Rehearsal');
    await browser.waitUntil(async () => (await rehearsal.getAttribute('aria-pressed')) === 'true', { timeout: 5000, timeoutMsg: 'Rehearsal did not turn on' });
    const rec = await click('button.bc-btn', 'REC');
    await browser.waitUntil(async () => /^REC \d/.test((await rec.getText()).trim()), { timeout: 30_000, timeoutMsg: 'Recording did not start' });
    await browser.pause(4000);
    await shot('recording');
    await rec.click();
    await click('[role="dialog"] button', 'Stop recording');
    await $('.bc-saved').waitForDisplayed({ timeout: 90_000 });
    await shot('recording-saved');
    const files = videosIn(folder);
    assert.ok(files.length > 0, `No recording in ${folder}`);
    const main = files.sort().at(0);
    await settled(main);
    const p = probe(main);
    assert.ok(p.video && p.frames > 0, `The recording has no frames:\n${p.text}`);
    console.log(`recording: ${p.frames} frames, ${p.seconds} s`);
    await rehearsal.click();
    await expectNoCrash();
    await expectNoErrors('recording');
  });
});
