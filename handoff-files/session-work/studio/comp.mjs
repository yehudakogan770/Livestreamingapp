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
// Playhead into the close-up clip.
await page.keyboard.press('Shift+4');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${dir}/comp-0.png` });
await page.getByRole('button', { name: 'Start a node composite' }).click();
await page.waitForTimeout(800);
// Add a Background node, then a Merge, joined.
const canvas = page.getByRole('application', { name: 'Node graph' });
const box = await canvas.boundingBox();
await page.mouse.click(box.x + 300, box.y + 200, { button: 'right' });
await page.waitForTimeout(300);
await page.getByText('Merge (layer two pictures)').click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${dir}/comp-1.png` });
// Add an effect: Gaussian blur in the chosen chain.
await page.getByRole('button', { name: 'Add node' }).click();
await page.waitForTimeout(300);
await page.getByText('Blur & sharpen').hover();
await page.waitForTimeout(300);
await page.getByText('Gaussian blur').click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${dir}/comp-2.png` });
console.log(logs.join('\n'));
await browser.close();
