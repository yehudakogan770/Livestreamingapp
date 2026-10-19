// The live show flows, step by step, each checked.
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 760 }, acceptDownloads: true });
  await ctx.grantPermissions(['camera', 'microphone'], { origin: 'http://localhost:1420' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 160)));
  await p.addInitScript(() => { try { localStorage.setItem('lumora.textSize', 'normal'); } catch {} });
  await p.goto('http://localhost:1420');
  await p.waitForTimeout(1500);
  await p.getByText('Skip for now').click().catch(() => {});
  const results = [];
  const check = async (name, fn) => {
    const before = errs.length;
    try {
      const r = await fn();
      results.push(`${r === false || errs.length > before ? '✗' : '✓'} ${name}${errs.length > before ? ' — ' + errs.slice(before).join(' | ') : ''}${typeof r === 'string' ? ' — ' + r : ''}`);
    } catch (e) {
      results.push(`✗ ${name} — ${e.message.split('\n')[0].slice(0, 140)}`);
    }
  };
  const air = () => p.locator('.mon--pgm .mon__head em').textContent();
  const next = () => p.locator('.mon--pvw .mon__head em').textContent();
  const add = async (kind) => {
    await p.getByRole('button', { name: /Add input/ }).first().click();
    const d = p.getByRole('dialog', { name: 'Add input' });
    await d.getByRole('button', { name: kind, exact: true }).click();
    if (kind === 'Camera') await d.getByRole('button', { name: 'fake_device_0' }).click();
    await d.getByRole('button', { name: 'Add input', exact: true }).click();
    await p.waitForTimeout(500);
  };
  await check('Add a camera, a test pattern and a colour', async () => {
    await add('Camera'); await add('Test pattern'); await add('Colour');
    return (await p.locator('.cambar__btn').count()) === 1 || 'camera buttons: ' + (await p.locator('.cambar__btn').count());
  });
  await check('Key 1 lines up input 1; Enter takes it', async () => {
    await p.keyboard.press('1'); await p.waitForTimeout(300);
    const n = await next();
    await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
    const a = await air();
    return n === a || `next ${n} / on air ${a}`;
  });
  await check('CUT (Shift+Enter) to input 2', async () => {
    await p.keyboard.press('2'); await p.waitForTimeout(200);
    await p.keyboard.press('Shift+Enter'); await p.waitForTimeout(400);
    return (await air()) === 'Test pattern' || 'on air ' + (await air());
  });
  await check('The fader: drag across mixes, then it springs back left', async () => {
    await p.keyboard.press('3'); await p.waitForTimeout(200);
    const t = await p.locator('.tbar__track').boundingBox();
    await p.mouse.move(t.x + 2, t.y + t.height / 2); await p.mouse.down();
    for (let i = 1; i <= 20; i++) await p.mouse.move(t.x + (t.width * i) / 20, t.y + t.height / 2);
    await p.mouse.up(); await p.waitForTimeout(700);
    const h = await p.locator('.tbar__handle').boundingBox();
    return ((await air()) === 'Colour' && h.x - t.x < 5) || `on air ${await air()}, handle at ${Math.round(h.x - t.x)}`;
  });
  await check('Fade to black and back', async () => {
    await p.getByRole('button', { name: 'Fade to black' }).click(); await p.waitForTimeout(3500);
    const label = await p.locator('.switch__ftbbtn').textContent();
    await p.getByRole('button', { name: 'Fade back up' }).click(); await p.waitForTimeout(3500);
    const back = await p.locator('.switch__ftbbtn').textContent();
    return (label.includes('Fade back up') && back.includes('Fade to black')) || `after fade: "${label}", after back: "${back}"`;
  });
  await check('Blank the Live screen (B) and back', async () => {
    await p.keyboard.press('b'); await p.waitForTimeout(300);
    const pressed = await p.getByRole('button', { name: 'Live', exact: true }).getAttribute('aria-pressed');
    await p.keyboard.press('b'); await p.waitForTimeout(300);
    const after = await p.getByRole('button', { name: 'Live', exact: true }).getAttribute('aria-pressed');
    return (pressed === 'true' && after === 'false') || `blank ${pressed} → ${after}`;
  });
  await check('PANIC: double-click on, click off', async () => {
    const btn = p.locator('button', { hasText: 'PANIC' });
    await btn.dblclick(); await p.waitForTimeout(400);
    const on = await btn.textContent();
    await btn.click(); await p.waitForTimeout(400);
    const off = await btn.textContent();
    return (/ON/.test(on) && !/ON/.test(off)) || `${on} → ${off}`;
  });
  await check('Overlay 1: a lower third over the picture, Shift+1 on and off', async () => {
    await p.getByRole('button', { name: 'Text', exact: true }).click();
    await p.getByText('Add a lower third…').click();
    const d = p.getByRole('dialog', { name: 'Add input' });
    await d.getByRole('button', { name: 'Add input', exact: true }).click(); await p.waitForTimeout(500);
    await p.getByRole('button', { name: 'Overlays', exact: true }).click();
    await p.getByText('Set up overlays…').click();
    const ed = p.getByRole('dialog', { name: 'Overlays' });
    const sel = ed.getByLabel('Overlay input');
    const opt = await sel.locator('option', { hasText: 'Speaker' }).first().getAttribute('value');
    await sel.selectOption(opt);
    await ed.getByRole('button', { name: /Save and put on air/ }).click(); await p.waitForTimeout(800);
    const on = await p.locator('.ovbar__btn.is-on').count();
    await p.keyboard.press('Shift+Digit1'); await p.waitForTimeout(800);
    const off = await p.locator('.ovbar__btn.is-on').count();
    return (on === 1 && off === 0) || `on ${on}, after Shift+1 ${off}`;
  });
  await check('Countdown: add, start from its controls, it counts', async () => {
    await p.getByRole('button', { name: 'Timer', exact: true }).click();
    await p.getByText('Add a countdown…').click();
    await p.getByRole('dialog', { name: 'Add input' }).getByRole('button', { name: 'Add input', exact: true }).click(); await p.waitForTimeout(600);
    await p.locator('.centre__more').getByRole('button', { name: /^Start/ }).first().click(); await p.waitForTimeout(2200);
    const txt = await p.locator('.centre__more').textContent();
    return /4:5\d/.test(txt) || 'shows: ' + txt.slice(0, 60);
  });
  await check('Presets: make one and use it', async () => {
    await p.getByRole('button', { name: '+ Add' }).first().click(); await p.waitForTimeout(500);
    await p.screenshot({ path: 'full/preset-1.png' });
    const d = p.locator('.modal');
    await d.locator('input').first().fill('Opening');
    await d.getByRole('button', { name: 'Create preset' }).click(); await p.waitForTimeout(600);
    const btn = p.getByRole('button', { name: /Opening/ });
    const n = await btn.count();
    if (n) await btn.first().click();
    return n > 0 || 'no preset button';
  });
  await check('Stage monitor: send a message', async () => {
    await p.keyboard.press('F3'); await p.waitForTimeout(500);
    await p.getByRole('textbox', { name: 'Message', exact: true }).fill('Two minutes left');
    await p.getByRole('button', { name: 'Show', exact: true }).click(); await p.waitForTimeout(500);
    const ok = await p.getByRole('button', { name: 'Clear message' }).isEnabled();
    await p.keyboard.press('F1'); await p.waitForTimeout(300);
    return ok || 'message not shown';
  });
  await check('Recording: REC starts and stops (browser keeps the file)', async () => {
    const rec = p.locator('button', { hasText: /^\s*●?\s*REC/ }).first();
    await rec.click(); await p.waitForTimeout(1500);
    await p.screenshot({ path: 'full/rec-1.png' });
    if (await p.locator('.modal').count()) return 'a window opened: ' + (await p.locator('.modal h2').first().textContent());
    await p.waitForTimeout(1500);
    const on = await rec.textContent();
    const dl = p.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await rec.click(); await p.waitForTimeout(1500);
    const confirm = p.getByRole('button', { name: /Stop recording|Stop/ });
    if (await confirm.count()) await confirm.first().click().catch(() => {});
    const file = await dl;
    return `button while recording: "${on.trim()}"; file: ${file ? file.suggestedFilename() : 'none offered'}`;
  });
  await p.screenshot({ path: 'full/flows-end.png' });
  for (const w of ['live', 'back', 'monitor', 'multiview']) {
    await check(`Output window: ${w}`, async () => {
      const q = await ctx.newPage();
      const e2 = [];
      q.on('pageerror', (e) => e2.push(e.message));
      await q.goto(`http://localhost:1420/?output=${w}`); await q.waitForTimeout(1500);
      await q.screenshot({ path: `full/out-${w}.png` });
      await q.close();
      return e2.length ? e2.join(' | ') : true;
    });
  }
  console.log(results.join('\n'));
  await b.close();
})();
