const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [w, h, size] of JSON.parse(process.env.SIZES || '[[1920,1020,"normal"],[1366,700,"normal"],[1920,1020,"large"],[2560,1380,"normal"],[1280,650,"normal"],[1024,720,"normal"]]')) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    p.setDefaultTimeout(20000);
    await p.addInitScript((s) => localStorage.setItem('lumora.textSize', s), size);
    await p.goto('http://localhost:1420');
    await p.getByRole('button', { name: 'Skip for now' }).click();
    for (const kind of ['Colour', 'Colour', 'Test pattern', 'Countdown', 'Countdown']) {
      await p.getByRole('button', { name: 'Add input' }).first().click();
      await p.getByRole('button', { name: new RegExp('^' + kind) }).first().click();
      await p.getByRole('dialog').getByRole('button', { name: 'Add input' }).click();
      await p.waitForTimeout(150);
    }
    await p.locator('.tile__pick').nth(2).dblclick();
    await p.locator('.tile__pick').nth(3).click();
    await p.waitForTimeout(400);
    const vis = await p.evaluate(() => {
      const over = document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth;
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; };
      return { over, take: r('.switch__take'), ftb: r('.switch__ftb'), card: r('.centre__more > *'), more: r('.centre__more'), stage: r('.stage'), tiles: r('.inputs'), area: r('.inputs-area'), side: document.querySelector('.control__work').classList.contains('is-side'), scrolled: document.querySelector('.inputs-area__grid')?.scrollTop, mixer: r('.mixer'), bar: r('.bar'), pvw: r('.mon--pvw .mon__screen'), pgm: r('.mon--pgm .mon__screen'), vh: innerHeight };
    });
    console.log(w, h, size, JSON.stringify(vis));
    await p.screenshot({ path: `fit-${w}-${size}.png` });
    await p.close();
  }
  await b.close();
})();
