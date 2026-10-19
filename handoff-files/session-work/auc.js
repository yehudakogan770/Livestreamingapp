const { chromium } = require('playwright-core');
const svg = (c1, c2, label, w = 1200, h = 900) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w/2}" cy="${h/2}" r="${h/4}" fill="#fff8"/><text x="50%" y="90%" font-size="60" text-anchor="middle" fill="#fff">${label}</text></svg>`);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  p.setDefaultTimeout(15000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  const items = [
    { id: 1, name: 'Silver Kiddush cup', detail: 'Donated by the Levi family', photo: svg('#8e9eab', '#eef2f3', 'Kiddush cup'), start: 180, step: 18, bids: [], sold: false },
    { id: 2, name: 'A week in Jerusalem', detail: 'Hotel for two, 7 nights', photo: '', start: 1000, step: 100, bids: [], sold: false },
  ];
  const kind = { type: 'auction', title: 'Chinese auction', currency: '$', items, current: 0, open: true, endsAt: null, lastBidAt: 0, soldAt: 0, nextId: 2, joinUrl: 'http://192.168.1.20:8765/vote', joinQr: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/><rect width="5" height="5"/></svg>', showJoin: true };
  await p.addInitScript((kind) => {
    localStorage.setItem('lumora.textSize', 'normal');
    localStorage.setItem('lumora.library', JSON.stringify([{ id: 'lib-1', name: 'Auction', category: 'Test', savedAt: 1, type: 'input', source: { name: 'Auction', kind } }]));
  }, kind);
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  await p.getByRole('button', { name: 'Library', exact: true }).click();
  await p.getByText('Open the library…').click();
  await p.getByRole('button', { name: 'Use in this event' }).click();
  await p.keyboard.press('Escape');
  await p.locator('.tile__pick').nth(0).dblclick();
  await p.getByRole('button', { name: /Options for / }).first().click();
  await p.getByRole('button', { name: 'Run the auction…' }).click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'auc0.png' });
  await p.getByLabel('Bidder').fill('Table 4'); await p.getByLabel('Bid amount').fill('180');
  await p.getByRole('button', { name: '+ Bid from the room' }).click();
  await p.getByLabel('Bidder').fill('Sarah Levi'); await p.getByLabel('Bid amount').fill('250');
  await p.getByRole('button', { name: '+ Bid from the room' }).click();
  await p.getByRole('button', { name: '60s' }).click().catch(() => {});
  await p.getByRole('button', { name: '1 min' }).click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: 'auc1.png' });
  await p.getByRole('button', { name: '🔨 Sold!' }).click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'auc2.png' });
  await p.getByRole('button', { name: 'Next item ▶' }).click();
  await p.waitForTimeout(400);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  await p.screenshot({ path: 'auc3.png' });
  console.log('errors', errs);
  await b.close();
})();
