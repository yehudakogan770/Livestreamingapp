// Every menu item: open it, look for errors, windows off the screen and scroll bars.
const { chromium } = require('playwright-core');
const MENUS = ['Event', 'Presets', 'Cues', 'Library', 'Inputs', 'Overlays', 'Text', 'Slideshow', '12 Pesukim', 'Timer', 'Visuals', 'Settings', 'Help'];
const SKIP = /Open event|Save event|Save a copy|Text size|New event/;
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 760 } });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost:1420' });
  const p = await ctx.newPage();
  let errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text()));
  p.on('dialog', (d) => d.dismiss());
  await p.addInitScript(() => localStorage.setItem('lumora.textSize', 'normal'));
  await p.goto('http://localhost:1420');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'full/00-first-run.png' });
  await p.getByText('Skip for now').click().catch(() => {});
  const report = [];
  const inspect = async (label) => {
    return p.evaluate(() => {
      const out = [];
      const modal = document.querySelector('.modal .modal__box');
      if (modal) {
        const r = modal.getBoundingClientRect();
        if (r.top < 0 || r.bottom > innerHeight + 1 || r.left < 0 || r.right > innerWidth + 1) out.push(`window off screen ${Math.round(r.top)}..${Math.round(r.bottom)}`);
        for (const el of modal.querySelectorAll('*')) {
          const cs = getComputedStyle(el);
          if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 40) out.push(`scrolls: .${String(el.className).split(' ')[0]} ${el.scrollHeight}/${el.clientHeight}`);
        }
        // Words spilling out of buttons.
        for (const el of modal.querySelectorAll('button')) {
          if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'hidden') out.push(`button too small: "${el.textContent.trim().slice(0, 30)}"`);
        }
      }
      return { title: modal?.querySelector('h2')?.textContent ?? document.querySelector('[role=dialog]')?.getAttribute('aria-label') ?? null, out };
    });
  };
  for (const m of MENUS) {
    await p.getByRole('button', { name: m, exact: true }).click();
    await p.waitForTimeout(200);
    const items = await p.locator('[role=menuitem]').allTextContents();
    await p.keyboard.press('Escape');
    for (let i = 0; i < items.length; i++) {
      const name = items[i].trim();
      if (SKIP.test(name)) continue;
      errs = [];
      await p.getByRole('button', { name: m, exact: true }).click();
      await p.waitForTimeout(150);
      await p.locator('[role=menuitem]').nth(i).click().catch((e) => errs.push('click failed ' + e.message.slice(0, 80)));
      await p.waitForTimeout(700);
      const info = await inspect(name);
      const file = `full/m-${m.replace(/\W/g, '')}-${i}.png`;
      await p.screenshot({ path: file });
      report.push({ menu: m, item: name, window: info.title, problems: [...info.out, ...errs] });
      // Close whatever opened.
      for (let k = 0; k < 3; k++) {
        if (!(await p.locator('.modal').count())) break;
        await p.keyboard.press('Escape');
        await p.waitForTimeout(200);
        if (await p.locator('.modal').count()) await p.locator('.modal .modal__head button').first().click().catch(() => {});
        await p.waitForTimeout(200);
      }
    }
  }
  require('fs').writeFileSync('full/menus.json', JSON.stringify(report, null, 1));
  for (const r of report) console.log(`${r.problems.length ? '✗' : '✓'} ${r.menu} → ${r.item}${r.window ? ` [${r.window}]` : ''}${r.problems.length ? '\n     ' + r.problems.join('\n     ') : ''}`);
  await b.close();
})();
