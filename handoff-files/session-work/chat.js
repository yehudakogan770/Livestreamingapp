const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  p.setDefaultTimeout(15000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  await p.getByRole('button', { name: 'Text', exact: true }).click();
  await p.getByText('Live chat comments (YouTube, Twitch)…').click();
  await p.getByRole('button', { name: '+ Make a chat comments input' }).click();
  // Pretend comments arrived (the real ones come from the internet).
  await p.evaluate(async () => {
    const { chat } = await import('/app/src/engine/chat.ts').catch(() => import('/src/engine/chat.ts'));
    chat.add([{ id: '1', platform: 'youtube', author: 'Sarah Levi', text: 'Mazel tov to the whole family! Watching from London 🎉', at: Date.now() },
              { id: '2', platform: 'twitch', author: 'dovid_k', text: 'Amazing band tonight', color: '#9b51e0', at: Date.now() }]);
  });
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Show', exact: true }).first().click();
  await p.waitForTimeout(300);
  console.log('toasts', await p.locator('.toast').allTextContents());
  console.log('btn', await p.locator('.chat__show').allTextContents());
  await p.locator('.tile__pick').nth(0).dblclick();
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'chat1.png' });
  console.log('errors', errs);
  await b.close();
})();
