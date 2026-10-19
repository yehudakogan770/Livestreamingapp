const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  await p.locator('.titlebar__item', { hasText: 'Text' }).click();
  await p.screenshot({ path: 'menu-text.png' });
  await p.getByText('Add a title…').click();
  console.log('add dialog kind:', await p.locator('.addinput__kind[aria-pressed="true"]').textContent(), '| template:', await p.locator('.addinput__list .seg[aria-pressed="true"]').first().textContent());
  await p.keyboard.press('Escape');
  await p.locator('.titlebar__item', { hasText: 'Help' }).click();
  await p.getByText('Keyboard shortcuts').click();
  await p.screenshot({ path: 'menu-keys.png' });
  console.log('disabled menus:', await p.locator('.titlebar__item[disabled]').allTextContents());
  console.log('errors', errs);
  await b.close();
})();
