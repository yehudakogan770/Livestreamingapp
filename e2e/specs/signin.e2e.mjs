// The installed program, exactly as people download it (the CI installer):
// it starts, nothing breaks, and it asks to sign in. This also proves the
// shipped build has no way past the sign-in (only the test build skips it).

import assert from 'node:assert/strict';
import { expectNoCrash, mainWindow, shot } from '../helpers.mjs';

describe(`The installed ${process.env.E2E_PRODUCT ?? 'program'}`, () => {
  before(async () => {
    await mainWindow();
  });

  it('starts and asks to sign in', async () => {
    await $('.gate').waitForDisplayed({ timeout: 90_000 });
    // "Checking your account…" gives way to the sign-in form (or a message, offline).
    await browser.waitUntil(async () => (await $('.gate__form').isExisting()) || (await $('.gate h1').isExisting()), {
      timeout: 60_000,
      timeoutMsg: 'The sign-in screen never finished checking',
    });
    await shot('sign-in');
    assert.equal(await $('.titlebar').isExisting(), false, 'Lumora opened without signing in');
    assert.equal(await $('.ed').isExisting(), false, 'Lumora Studio opened without signing in');
    assert.equal(await browser.execute(() => 'lumoraE2E' in window || '__lumoraE2E' in window), false, 'The shipped program has the test hooks');
    await expectNoCrash();
  });
});
