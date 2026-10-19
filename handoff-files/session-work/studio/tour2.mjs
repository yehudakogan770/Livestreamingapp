import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const dir = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/studio/tour';
const W = Number(process.env.W ?? 1600);
const H = Number(process.env.H ?? 950);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
let step = 'load';
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall') && !m.text().includes('React DevTools')) logs.push(`[${step}] ${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[${step}] pageerror: ${e.message}`));
const at = async (name, f) => {
  step = name;
  try {
    await f();
  } catch (e) {
    logs.push(`[${name}] FAILED: ${e.message.split('\n')[0]}`);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/${W}-b${name}.png` });
};
await page.goto('http://127.0.0.1:1471/?demo');
await page.waitForTimeout(5000);
await at('01-text-tab', async () => page.getByRole('tab', { name: /Text/ }).first().click());
await at('02-publish', async () => page.getByRole('button', { name: /Publish/ }).first().click());
await page.keyboard.press('Escape');
await at('03-trim', async () => {
  const c = page.locator('.clip', { hasText: 'Wide' }).first();
  const b = await c.boundingBox();
  await page.mouse.move(b.x + b.width - 2, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 60, b.y + 20, { steps: 6 });
  await page.mouse.up();
});
await at('04-export', async () => page.getByRole('button', { name: 'Export' }).first().click());
await page.keyboard.press('Escape');
console.log(logs.join('\n') || 'no console problems');
await browser.close();
