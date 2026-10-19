const { start } = require('./lib.cjs');
(async () => {
  const url = process.argv[2] || 'http://localhost:1532/titler/';
  const { b, p, shot, flush } = await start(url);
  await p.click('text=Name and role');
  await p.waitForTimeout(500);
  const box = await (await p.$('.tt-center canvas')).boundingBox();
  await p.mouse.click(box.x + 10, box.y + 30); // focus away from inputs
  await p.keyboard.press('Control+a');
  await p.keyboard.press('Control+Shift+c');
  await p.waitForTimeout(300);
  await p.keyboard.press('Control+d');
  await p.waitForTimeout(300);
  console.log(await p.$$eval('.tt-timeline .tt-name', (els) => els.map((e) => e.textContent).join(' | ')));
  const insp = p.locator('[data-testid=titler-inspector]');
  const sec = insp.locator('.tt-section-title', { hasText: "This copy's changes" });
  console.log('override section', await sec.count());
  if (await sec.count()) {
    if ((await sec.getAttribute('aria-expanded')) === 'false') await sec.click();
    await insp.getByLabel('Layer to change in this copy').selectOption({ label: 'Name' });
    await insp.getByLabel('Words in this copy').fill('Second Guest');
    await p.waitForTimeout(200);
    // move the whole copy (its transform)
    const posY = insp.getByLabel('Position y', { exact: true });
    if (await posY.count()) {
      await posY.click();
      await posY.fill('-260');
      await posY.press('Enter');
    }
    await p.waitForTimeout(300);
    await sec.scrollIntoViewIfNeeded();
    await shot('o1-override');
  }
  flush('override');
  await b.close();
})();
