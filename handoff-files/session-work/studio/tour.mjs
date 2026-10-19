import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const dir = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/studio/tour';
import { mkdirSync } from 'node:fs';
mkdirSync(dir, { recursive: true });
const W = Number(process.env.W ?? 1600);
const H = Number(process.env.H ?? 950);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
let step = 'load';
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall') && !m.text().includes('React DevTools')) logs.push(`[${step}] ${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[${step}] pageerror: ${e.message}`));
const shot = async (name) => page.screenshot({ path: `${dir}/${String(W)}-${name}.png` });
const at = async (name, f) => {
  step = name;
  try {
    await f();
  } catch (e) {
    logs.push(`[${name}] FAILED: ${e.message.split('\n')[0]}`);
  }
  await page.waitForTimeout(500);
  await shot(name);
};
await page.goto('http://127.0.0.1:1471/?demo');
await page.waitForTimeout(5000);
await at('01-start', async () => {});
await at('02-menu-file', async () => page.getByRole('button', { name: 'File' }).click());
await page.keyboard.press('Escape');
await at('03-menu-sequence', async () => page.getByRole('button', { name: 'Sequence' }).first().click());
await page.keyboard.press('Escape');
await at('04-menu-ai', async () => page.getByRole('button', { name: 'AI' }).click());
await page.keyboard.press('Escape');
// Select a clip, razor at the playhead.
await at('05-select-clip', async () => {
  await page.locator('.tl__scroll').click({ position: { x: 400, y: 10 } });
  await page.getByText('Wide', { exact: true }).last().click();
});
await at('06-razor', async () => {
  await page.keyboard.press('Control+k');
});
await at('07-transition', async () => {
  await page.keyboard.press('Control+d');
});
await at('08-inspector', async () => {});
await at('09-effects-tab', async () => page.getByRole('tab', { name: 'Effects' }).click());
await at('10-text-tab', async () => page.getByRole('tab', { name: /Text/ }).click());
await at('11-color', async () => page.getByRole('tab', { name: 'Color' }).click());
await at('12-audio', async () => page.getByRole('tab', { name: 'Audio' }).click());
await at('13-composite', async () => page.getByRole('tab', { name: 'Composite' }).click());
await at('14-edit', async () => page.getByRole('tab', { name: 'Edit' }).click());
await at('15-export', async () => page.getByRole('button', { name: 'Export' }).click());
await page.keyboard.press('Escape');
await at('16-transcript', async () => page.getByRole('tab', { name: 'Transcript' }).click());
await at('17-magnetic', async () => page.getByRole('button', { name: 'Magnetic' }).click());
await at('18-help', async () => page.getByRole('button', { name: 'Help' }).click());
await page.keyboard.press('Escape');
console.log(logs.join('\n') || 'no console problems');
await browser.close();
