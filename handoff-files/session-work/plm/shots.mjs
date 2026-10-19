import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = '/tmp/claude-0/planner-mobile';
mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:1499/';
const P1 = '11111111-1111-4111-8111-111111111111';
const only = process.argv[2];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const problems = [];

async function noHScroll(page, label) {
  const r = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const over = [...document.querySelectorAll('body *')]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && (b.right > w + 1 || b.left < -1) && getComputedStyle(e).position !== 'fixed';
      })
      .slice(0, 5)
      .map((e) => `${e.tagName}.${e.className} ${Math.round(e.getBoundingClientRect().right)}`);
    return { sw: document.documentElement.scrollWidth, w, over };
  });
  if (r.sw > r.w) problems.push(`${label}: horizontal scroll ${r.sw} > ${r.w} ${r.over.join(' | ')}`);
}
async function smallTargets(page, label) {
  const r = await page.evaluate(() =>
    [...document.querySelectorAll('button, a, input, select, textarea, .card__grip')]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && b.height < 40 && !e.closest('.comment') && getComputedStyle(e).visibility !== 'hidden';
      })
      .map((e) => `${e.tagName}.${e.className}[${e.getAttribute('aria-label') ?? e.textContent?.slice(0, 20)}] ${Math.round(e.getBoundingClientRect().height)}`),
  );
  if (r.length) problems.push(`${label}: small targets: ${r.join(' | ')}`);
}
async function fontSizes(page, label) {
  const r = await page.evaluate(() =>
    [...document.querySelectorAll('input, select, textarea')].filter((e) => e.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.className),
  );
  if (r.length) problems.push(`${label}: inputs under 16px: ${r.join(', ')}`);
}

const phones = [
  ['iphone14', devices['iPhone 14']],
  ['pixel7', devices['Pixel 7']],
  ['galaxy-360', devices['Galaxy S8']],
];
for (const [name, dev] of phones) {
  if (only && only !== name) continue;
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ ...dev, colorScheme: scheme });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${name}: page error ${e.message}`));
    const tag = `${name}-${scheme}`;
    await page.goto(BASE + '#/');
    await page.waitForSelector('.plancard');
    await page.screenshot({ path: `${OUT}/${tag}-1-plans.png` });
    await noHScroll(page, `${tag} plans`);
    await fontSizes(page, `${tag} plans`);
    await page.click('.plancard');
    await page.waitForSelector('.card');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/${tag}-2-plan.png` });
    await noHScroll(page, `${tag} plan`);
    if (scheme === 'light') await smallTargets(page, `${tag} plan`);
    // Open a cue
    await page.getByRole('button', { name: /^Cue 2:/ }).click();
    await page.waitForSelector('.cuesheet');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${tag}-3-sheet.png` });
    await noHScroll(page, `${tag} sheet`);
    await fontSizes(page, `${tag} sheet`);
    if (scheme === 'light') {
      await smallTargets(page, `${tag} sheet`);
      await page.locator('.cuesheet__body').evaluate((e) => (e.scrollTop = e.scrollHeight));
      await page.screenshot({ path: `${OUT}/${tag}-4-sheet-bottom.png` });
      // Move down with the sheet's button, then Back closes it.
      await page.getByRole('button', { name: 'Move cue down' }).click();
      const title = await page.locator('.cuesheet__title').textContent();
      if (!/Cue 3/.test(title)) problems.push(`${tag}: move down did not move (${title})`);
      await page.goBack();
      await page.waitForTimeout(200);
      if (await page.locator('.cuesheet').count()) problems.push(`${tag}: Back did not close the sheet`);
      if (!page.url().includes(P1)) problems.push(`${tag}: Back left the plan (${page.url()})`);
      // Drag the first card's handle below the third card.
      await page.locator('.phone__list').evaluate((e) => (e.scrollTop = 0));
      await page.waitForTimeout(100);
      const grips = page.locator('.card__grip');
      const g = await grips.nth(0).boundingBox();
      const target = await page.locator('.card').nth(2).boundingBox();
      const before = await page.locator('.card__title').allTextContents();
      // A finger, not a mouse: touch events through the DevTools protocol.
      const cdp = await ctx.newCDPSession(page);
      const x = g.x + g.width / 2;
      const y0 = g.y + g.height / 2;
      const y1 = target.y + target.height * 0.8;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
      for (let k = 1; k <= 10; k++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * k) / 10 }] });
      }
      await page.screenshot({ path: `${OUT}/${tag}-5-dragging.png` });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(100);
      const after = await page.locator('.card__title').allTextContents();
      if (after[2] !== before[0]) problems.push(`${tag}: drag did not reorder: ${after.slice(0, 4).join(', ')}`);
      // Details, menu
      await page.click('.phone__when');
      await page.screenshot({ path: `${OUT}/${tag}-6-details.png` });
      await fontSizes(page, `${tag} details`);
      await noHScroll(page, `${tag} details`);
      await page.click('.phone__when');
      await page.getByRole('button', { name: 'More' }).click();
      await page.screenshot({ path: `${OUT}/${tag}-7-more.png` });
      await page.getByRole('menuitem', { name: 'Cancel' }).click();
      await page.getByRole('button', { name: 'Share' }).click();
      await page.waitForSelector('.dialog');
      await page.waitForTimeout(100);
      await page.screenshot({ path: `${OUT}/${tag}-8-share.png` });
      await noHScroll(page, `${tag} share`);
      await page.keyboard.press('Escape');
      // Add cue opens the sheet for the new cue
      await page.getByRole('button', { name: 'Add cue' }).click();
      await page.waitForSelector('.cuesheet');
      const t2 = await page.locator('.cuesheet__title').textContent();
      if (!/Cue 10/.test(t2)) problems.push(`${tag}: add cue opened ${t2}`);
      await page.getByRole('button', { name: 'Done' }).click();
      await page.waitForTimeout(100);
      if (await page.locator('.cuesheet').count()) problems.push(`${tag}: Done did not close`);
      // Landscape
      await page.setViewportSize({ width: dev.viewport.height, height: dev.viewport.width });
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${OUT}/${tag}-9-landscape.png` });
      await noHScroll(page, `${tag} landscape`);
      if (!(await page.locator('.phone').count())) problems.push(`${tag}: landscape phone did not keep the phone layout`);
    }
    await ctx.close();
  }
}

const big = [
  ['ipad-portrait', { ...devices['iPad (gen 7)'] }],
  ['ipad-landscape', { ...devices['iPad (gen 7) landscape'] }],
  ['desktop-1366', { viewport: { width: 1366, height: 800 } }],
];
for (const [name, dev] of big) {
  if (only && only !== name) continue;
  const ctx = await b.newContext({ ...dev, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: page error ${e.message}`));
  await page.goto(BASE + '#/');
  await page.waitForSelector('table.plans');
  await page.screenshot({ path: `${OUT}/${name}-1-plans.png` });
  await page.goto(BASE + `#/plan/${P1}`);
  await page.waitForSelector('table.cues');
  await page.waitForTimeout(150);
  await page.getByLabel('Cue 2', { exact: true }).click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}/${name}-2-plan.png` });
  await noHScroll(page, `${name} plan`);
  if (!(await page.locator('.inspector .inspector__in').isVisible())) problems.push(`${name}: details not in the side panel`);
  const ins = await page.locator('.inspector').boundingBox();
  const sheet = await page.locator('.sheet').boundingBox();
  if (!(ins.x > sheet.x + sheet.width - 2)) problems.push(`${name}: inspector not beside the sheet`);
  const sw = await page.locator('.sheet').evaluate((e) => e.scrollWidth - e.clientWidth);
  if (sw > 0) problems.push(`${name}: cue sheet scrolls sideways by ${sw}`);
  // drag on the table handle
  const before = await page.locator('.cell--title').evaluateAll((l) => l.map((e) => e.value));
  const h = await page.locator('td.handle').nth(0).boundingBox();
  const row = await page.locator('tr.cues__row').nth(2).boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, row.y + row.height * 0.8, { steps: 8 });
  await page.mouse.up();
  const after = await page.locator('.cell--title').evaluateAll((l) => l.map((e) => e.value));
  if (after[2] !== before[0]) problems.push(`${name}: table drag did not reorder: ${after.slice(0, 4).join(', ')}`);
  await ctx.close();
}
await b.close();
console.log(problems.length ? problems.join('\n') : 'OK');
