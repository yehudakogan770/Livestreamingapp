// The kinds that need something filled in first.
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--enable-usermedia-screen-capturing'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 760 } });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost:1420' });
  const p = await ctx.newPage();
  let errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 160)));
  await p.addInitScript(() => { try { localStorage.setItem('lumora.textSize', 'normal'); } catch {} });
  await p.goto('http://localhost:1420');
  await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  const fill = {
    'Audience poll': async (d) => {
      await d.locator('.addinput__setup input').first().fill('Which song next?');
      await d.locator('.addinput__setup textarea').first().fill('Siman Tov\nOd Yishama\nHava Nagila');
    },
    'Song lyrics': async (d) => d.getByPlaceholder(/Verse one/).fill('Siman tov u mazel tov\nMazel tov v siman tov\n\nYehei lanu\nU l chol Yisrael'),
    'Screen capture': async (d) => {
      for (const btn of await d.locator('.addinput__setup button').all()) {
        const t = await btn.textContent();
        if (/screen|choose|share/i.test(t ?? '')) { await btn.click().catch(() => {}); break; }
      }
      await p.waitForTimeout(1500);
    },
    'Web page': async (d) => {
      const inp = d.locator('.addinput__setup input').first();
      await inp.fill('https://example.com');
    },
    Microphone: async (d) => d.getByRole('button', { name: 'Fake Audio Input 1' }).click(),
  };
  for (const [kind, fn] of Object.entries(fill)) {
    errs = [];
    await p.getByRole('button', { name: /Add input/ }).first().click();
    const d = p.getByRole('dialog', { name: 'Add input' });
    await d.getByRole('button', { name: kind, exact: true }).click();
    await p.waitForTimeout(600);
    await fn(d).catch((e) => errs.push('fill: ' + e.message.slice(0, 80)));
    await p.waitForTimeout(500);
    const add = d.getByRole('button', { name: 'Add input', exact: true });
    const ok = await add.isEnabled();
    await p.screenshot({ path: `full/f-${kind.replace(/\W+/g, '')}.png` });
    if (ok) await add.click();
    else await p.keyboard.press('Escape');
    await p.waitForTimeout(700);
    if (ok && kind !== 'Microphone') {
      await p.getByRole('button', { name: 'CUT', exact: true }).click().catch(() => {});
      await p.waitForTimeout(1000);
    }
    const air = await p.locator('.mon--pgm .mon__head em').textContent();
    const mixer = kind === 'Microphone' ? (await p.locator('.mixer, [aria-label*="mixer" i]').first().textContent().catch(() => '')).slice(0, 80) : '';
    console.log(`${ok && !errs.length ? '✓' : '✗'} ${kind.padEnd(16)} added:${ok} on air:${air} ${mixer ? 'mixer:' + mixer : ''} ${errs.join(' | ')}`);
  }
  await p.screenshot({ path: 'full/f-end.png' });
  await b.close();
})();
