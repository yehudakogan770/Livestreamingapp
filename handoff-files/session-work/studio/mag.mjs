import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const dir = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/studio';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const logs = [];
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall')) logs.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto('http://127.0.0.1:1471/?demo');
await page.waitForTimeout(5000);
await page.getByRole('button', { name: 'Magnetic' }).click();
await page.waitForTimeout(300);
// The V1 clip "Wide": drag it to the right past the middle of the next clip (reorder).
const wide = page.locator('.clip', { hasText: 'Wide' }).first();
const box = await wide.boundingBox();
console.log('wide box', JSON.stringify(box));
await page.mouse.move(box.x + 40, box.y + 20);
await page.mouse.down();
await page.mouse.move(box.x + 300, box.y + 20, { steps: 8 });
await page.mouse.move(box.x + 700, box.y + 20, { steps: 8 });
await page.screenshot({ path: `${dir}/mag-drag.png` });
await page.mouse.up();
await page.waitForTimeout(600);
await page.screenshot({ path: `${dir}/mag-after.png` });
const names = await page.locator('.clip--video').allInnerTexts();
console.log(names.slice(0, 12).map((x) => x.replace(/\s+/g, ' ')).join(' | '));
// Delete the first V1 clip: it closes up.
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
await wide.click({ position: { x: 40, y: 20 } });
await page.keyboard.press('Delete');
await page.waitForTimeout(600);
await page.screenshot({ path: `${dir}/mag-delete.png` });
console.log(logs.join('\n') || 'no console problems');
await browser.close();
