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
// The second V1 clip (Host close-up) at 0:08, under the title on V2.
await page.locator('.tl__scroll').click({ position: { x: 600, y: 10 } });
await page.waitForTimeout(500);
await page.keyboard.press('Shift+4');
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Start a node composite' }).click();
await page.waitForTimeout(600);
const canvas = page.getByRole('application', { name: 'Node graph' });
let box = await canvas.boundingBox();
// Choose the Output, then add a Merge into its chain (Clip -> Merge.bg -> Output).
await page.locator('.cnode--out .cnode__head').click();
await page.getByRole('button', { name: 'Add node' }).click();
await page.getByText('Merge (layer two pictures)').click();
await page.waitForTimeout(400);
// A shape mask with nothing joined (a white ellipse), added from the right-click menu.
await page.mouse.click(box.x + 120, box.y + 40);
await page.mouse.click(box.x + 200, box.y + 250, { button: 'right' });
await page.getByText('Shape mask').click();
await page.waitForTimeout(400);
// A solid color: joined to the Merge foreground by dragging.
await page.mouse.click(box.x + 120, box.y + 40);
await page.mouse.click(box.x + 200, box.y + 40, { button: 'right' });
await page.getByText('Solid color').click();
await page.waitForTimeout(400);
const drag = async (from, to) => {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
};
const merge = page.locator('.cnode--merge');
await drag(page.locator('.cnode--solid .cnode__out'), merge.locator('.cnode__in').nth(1));
await drag(page.locator('.cnode--mask .cnode__out'), merge.locator('.cnode__in').nth(2));
await page.getByRole('button', { name: 'Fit' }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${dir}/comp-3.png` });
const joined = await page.locator('.cnode__in.is-joined').count();
console.log('joined inputs', joined);
// Show the mask node alone.
await page.getByRole('button', { name: 'Show Shape mask in the viewer' }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${dir}/comp-4.png` });
// Undo all the way: the composite goes.
console.log(logs.join('\n'));
await browser.close();
