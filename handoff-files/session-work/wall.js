const { chromium } = require('playwright-core');
const svg = (c1, c2, label, w = 1200, h = 800) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w/2}" cy="${h/2}" r="${h/4}" fill="#fff8"/><text x="50%" y="90%" font-size="60" text-anchor="middle" fill="#fff">${label}</text></svg>`);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  p.setDefaultTimeout(15000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  const msgs = [
    { id: 1, name: 'Sarah Levi', text: 'Mazel tov to the chatan and kallah! May you build a bayit ne’eman b’Yisrael.', photo: '', at: 1, approved: true },
    { id: 2, name: 'The Cohen family', text: 'Wishing you a lifetime of happiness together', photo: svg('#e0473b', '#f2b233', 'Wedding'), at: 2, approved: true },
    { id: 3, name: 'David', text: '', photo: svg('#2f80ed', '#27ae60', 'Dancing', 800, 1000), at: 3, approved: true },
    { id: 4, name: 'Anonymous', text: 'Siman tov u mazel tov!', photo: '', at: 4, approved: false },
    { id: 5, name: 'Miriam K.', text: 'So happy for you both ❤️', photo: '', at: 5, approved: true },
  ];
  const kind = { type: 'wall', title: 'Messages for Chaim & Rivka', prompt: 'Write a blessing for the couple', messages: msgs, open: false, photos: true, autoApprove: false, style: 'cards', seconds: 8, pinned: null, nextId: 5, joinUrl: '', joinQr: '', showJoin: true };
  await p.addInitScript((kind) => {
    localStorage.setItem('lumora.textSize', 'normal');
    localStorage.setItem('lumora.library', JSON.stringify([{ id: 'lib-1', name: 'Wall', category: 'Test', savedAt: 1, type: 'input', source: { name: 'Messages', kind } }]));
  }, kind);
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  // Add from the library
  await p.getByRole('button', { name: 'Library', exact: true }).click();
  await p.getByText('Open the library…').click();
  await p.getByRole('button', { name: 'Use in this event' }).click();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  await p.locator('.tile__pick').nth(0).dblclick();
  await p.getByRole('button', { name: /Options for / }).first().click();
  await p.getByRole('button', { name: 'Run the messages wall…' }).click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'wall1.png' });
  await p.getByRole('button', { name: 'Newest six' }).click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'wall2.png' });
  await p.getByRole('button', { name: 'Ticker along the bottom' }).click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'wall3.png' });
  await p.getByRole('button', { name: 'One at a time' }).click();
  await p.getByRole('button', { name: 'Show now' }).nth(2).click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'wall4.png' });
  await p.getByRole('button', { name: 'Show now' }).nth(1).click();
  await p.getByRole('button', { name: /Take messages from phones/ }).click();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'wall5.png' });
  console.log('errors', errs);
  await b.close();
})();
