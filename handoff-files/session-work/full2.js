// Every kind of input: add it, put it on air, look for errors.
const { chromium } = require('playwright-core');
const path = require('path');
const here = (f) => path.join(__dirname, f);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 760 } });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost:1420' });
  const p = await ctx.newPage();
  let errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text().slice(0, 160)));
  p.on('dialog', (d) => d.accept());
  let kindNow = '';
  p.on('filechooser', (fc) => {
    const f = /Video|Sound|music/.test(kindNow) ? (/Sound|music/.test(kindNow) ? here('tone.wav') : here('sample.webm')) : /Slideshow/.test(kindNow) ? here('sample.pdf') : here('sample.png');
    fc.setFiles(fc.isMultiple() ? [f] : f).catch(() => {});
  });
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  await p.goto('http://localhost:1420');
  await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  await p.getByRole('button', { name: /Add input/ }).first().click();
  const kinds = await p.locator('.addinput__kind').allTextContents();
  await p.keyboard.press('Escape');
  const results = [];
  for (let i = 0; i < kinds.length; i++) {
    kindNow = kinds[i];
    if (/3D logo/.test(kindNow)) continue;
    errs = [];
    let note = '';
    await p.getByRole('button', { name: /Add input/ }).first().click();
    const d = p.getByRole('dialog', { name: 'Add input' });
    await d.locator('.addinput__kind').nth(i).click();
    await p.waitForTimeout(500);
    if (/Camera/.test(kindNow)) await d.getByRole('button', { name: 'fake_device_0' }).click().catch(() => (note += 'no camera; '));
    // File pickers, links and anything else the form needs.
    for (const btn of await d.locator('.addinput__setup button').all()) {
      const t = (await btn.textContent()) ?? '';
      if (/…/.test(t) && !/input as a slide/i.test(t) && (await btn.isEnabled())) {
        await btn.click().catch(() => {});
        await p.waitForTimeout(800);
        break;
      }
    }
    for (const inp of await d.locator('.addinput__setup input[type=url], .addinput__setup input[placeholder*="http"], .addinput__setup input[placeholder*="rtmp"], .addinput__setup input[placeholder*="srt"]').all()) {
      await inp.fill(/Web page/.test(kindNow) ? 'https://example.com' : 'https://example.com/live.m3u8').catch(() => {});
    }
    await p.waitForTimeout(300);
    const add = d.getByRole('button', { name: 'Add input', exact: true });
    if (!(await add.isEnabled())) {
      note += 'Add input stays greyed out; ';
      await p.screenshot({ path: `full/k-${i}-blocked.png` });
      await p.keyboard.press('Escape');
      results.push({ kind: kindNow, ok: false, note, errs });
      continue;
    }
    await add.click();
    await p.waitForTimeout(700);
    if (await p.locator('.modal').count()) {
      note += 'window stayed open; ';
      await p.screenshot({ path: `full/k-${i}-stuck.png` });
      await p.keyboard.press('Escape');
    }
    const next = (await p.locator('.mon--pvw .mon__head em').textContent().catch(() => '')) ?? '';
    const cut = p.getByRole('button', { name: 'CUT', exact: true });
    if (await cut.isEnabled().catch(() => false)) {
      await cut.click();
      await p.waitForTimeout(1200);
    }
    const air = (await p.locator('.mon--pgm .mon__head em').textContent().catch(() => '')) ?? '';
    const bar = (await p.locator('.ovbar__btn.is-on').allTextContents()).join(',');
    await p.screenshot({ path: `full/k-${i}-${kindNow.replace(/\W+/g, '')}.png` });
    results.push({ kind: kindNow, ok: errs.length === 0, next, air, overlay: bar, note, errs: [...errs] });
  }
  require('fs').writeFileSync('full/kinds.json', JSON.stringify(results, null, 1));
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.kind.padEnd(22)} next:${(r.next || '').padEnd(18)} on air:${(r.air || '').padEnd(18)}${r.overlay ? ' overlay:' + r.overlay : ''} ${r.note}${r.errs.length ? '\n     ' + r.errs.join('\n     ') : ''}`);
  await b.close();
})();
