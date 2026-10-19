const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [w, h] of [[1670, 887], [1280, 760]]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })).newPage();
    await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
    await p.goto('http://localhost:1420');
    await p.waitForTimeout(1500);
    await p.getByText('Skip for now').click().catch(() => {});
    await p.getByRole('button', { name: '12 Pesukim', exact: true }).click();
    await p.getByText('Add the 12 Pesukim bar (ready in Next)').click();
    await p.waitForTimeout(700);
    await p.keyboard.press('Space');
    await p.waitForTimeout(300);
    await p.locator('.pk').screenshot({ path: `pk2-${w}.png` });
    // Anything whose text spills out of its box.
    console.log(w, await p.evaluate(() => [...document.querySelectorAll('.pk *')].filter((e) => e.children.length === 0 && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) && e.clientWidth > 0).map((e) => `${e.className || e.tagName}: ${e.textContent?.slice(0, 20)} ${e.scrollWidth}x${e.scrollHeight} in ${e.clientWidth}x${e.clientHeight}`)));
  }
  await b.close();
})();
