const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage(); p.setDefaultTimeout(8000);
  await p.addInitScript(() => { try { localStorage.setItem('lumora.textSize', 'normal'); localStorage.setItem('lumora.jewishTools', 'on'); } catch {} });
  await p.goto('http://localhost:1420'); await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  await p.getByRole('button', { name: 'Inputs', exact: true }).click(); await p.waitForTimeout(200);
  await p.getByRole('menuitem', { name: /12 Pesukim bar/ }).click(); await p.waitForTimeout(1200);
  console.log(JSON.stringify(await p.evaluate(() => {
    const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return [q, Math.round(b.width), Math.round(b.height)]; };
    return [r('.tile__thumb'), r('.tile__frame'), r('.tile__frame > *'), r('.tile__frame .pes'), r('.tile__frame .pes__bar')];
  })));
  await p.locator('.tile').first().screenshot({ path: 'tile.png' });
  await b.close();
})();
