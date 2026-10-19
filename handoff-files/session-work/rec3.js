const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  await p.getByRole('button', { name: 'Make one and put it in Next' }).click();
  await p.getByRole('button', { name: /^TAKE/ }).click();
  await p.getByRole('button', { name: 'REC' }).click();
  await p.waitForTimeout(4000);
  await p.locator('.bc-btn').first().click();
  await p.getByRole('button', { name: 'Stop recording' }).click();
  await p.waitForTimeout(1000);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('.bc-saved a').click()]);
  await dl.saveAs('browser-rec.webm');
  await b.close();
})();
