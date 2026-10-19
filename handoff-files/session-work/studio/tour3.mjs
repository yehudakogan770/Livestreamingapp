import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const dir = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/studio/tour';
const W = Number(process.env.W ?? 1100);
const H = Number(process.env.H ?? 720);
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
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/${W}-c${name}.png` });
};
await page.goto('http://127.0.0.1:1471/?demo');
await page.waitForTimeout(5000);
await at('01-composite', async () => page.getByRole('tab', { name: 'Composite' }).click());
await at('02-color', async () => page.getByRole('tab', { name: 'Color' }).click());
await at('03-audio', async () => page.getByRole('tab', { name: 'Audio' }).click());
console.log(logs.join('\n') || 'no console problems');
await browser.close();
