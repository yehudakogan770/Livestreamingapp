const { chromium } = require('playwright-core');
const path = require('path');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  const log = [];
  p.on('pageerror', (e) => log.push('ERR ' + e.message));
  p.on('console', (m) => log.push(m.type() + ' ' + m.text().slice(0, 200)));
  p.on('requestfailed', (r) => log.push('FAILED ' + r.url().slice(0, 100) + ' ' + r.failure()?.errorText));
  await p.addInitScript(() => { try { localStorage.setItem('lumora.textSize', 'normal'); } catch {} });
  await p.goto('http://localhost:1420');
  await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  for (const [which, file] of [['+ Pictures…', 'sample.png'], ['+ PDF…', 'sample.pdf']]) {
    await p.getByRole('button', { name: /Add input/ }).first().click();
    const d = p.getByRole('dialog', { name: 'Add input' });
    await d.getByRole('button', { name: 'Slideshow', exact: true }).click();
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), d.getByRole('button', { name: which }).click()]);
    await fc.setFiles(path.join(__dirname, file));
    await p.waitForTimeout(3000);
    console.log(which, 'slides:', await d.locator('text=/SLIDES \\(\\d+\\)/i').textContent().catch(() => '?'));
    await p.screenshot({ path: `full/slides-${file}.png` });
    await d.getByRole('button', { name: 'Add input', exact: true }).click();
    await p.waitForTimeout(800);
    await p.getByRole('button', { name: 'CUT', exact: true }).click();
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `full/slides-air-${file}.png` });
  }
  console.log(log.filter((l) => !/^(debug|info|log) \[vite\]/.test(l)).join('\n'));
  await b.close();
})();
