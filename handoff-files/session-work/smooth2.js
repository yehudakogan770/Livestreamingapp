const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('lumora.textSize', 'normal'); } catch {} });
  await p.goto('http://localhost:1420');
  await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  await p.getByRole('button', { name: '12 Pesukim', exact: true }).click();
  await p.getByText('Add the 12 Pesukim bar (ready in Next)').click();
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    window.__o = [];
    let n = 0;
    requestAnimationFrame(function f() {
      const ins = [...document.querySelectorAll('.mon--pvw .pes__in')];
      window.__o.push(ins.map((e) => (e.classList.contains('pes__in--out') ? 'out ' : 'in ') + Number(getComputedStyle(e).opacity).toFixed(2) + ' ' + e.textContent.slice(0, 5)).join(' | '));
      if (++n < 22) requestAnimationFrame(f);
    });
  });
  await p.keyboard.press('Space');
  await p.waitForTimeout(700);
  console.log((await p.evaluate(() => window.__o)).join('\n'));
  // The recording draws the same.
  const ok = await p.evaluate(async () => {
    const { ProgramCompositor } = await import('/src/broadcast/compositor.ts');
    const { defaultPesukim } = await import('/src/engine/pesukim.ts');
    const c = new ProgramCompositor({ mediaUrl: (x) => x }, 960, 540);
    c.setShow({ sources: [], event: {} });
    const d = defaultPesukim();
    d.place = { pasuk: 0, word: 0, whole: false, blank: false, intro: false, changedAt: 1000 };
    c.pesukim(d, {}, 5000, 960, 540);
    d.place = { ...d.place, word: 1, changedAt: 6000 };
    c.pesukim(d, {}, 6090, 960, 540);
    return c.canvas.toDataURL();
  });
  require('fs').writeFileSync('crossfade.png', Buffer.from(ok.split(',')[1], 'base64'));
  console.log('errors', errs);
  await b.close();
})();
