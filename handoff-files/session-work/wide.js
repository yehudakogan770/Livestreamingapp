const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1024, height: 720 } });
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  await p.goto('http://localhost:1420');
  await p.getByRole('button', { name: 'Skip for now' }).click();
  await p.waitForTimeout(500);
  console.log(await p.evaluate(() => {
    const out = [];
    for (const e of document.querySelectorAll('body *')) {
      const r = e.getBoundingClientRect();
      if (r.right > innerWidth + 1 && r.width > 0) out.push(`${e.tagName}.${e.className} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
    }
    return out.slice(0, 12);
  }));
  await b.close();
})();
