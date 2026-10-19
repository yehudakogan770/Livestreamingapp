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
await page.getByText('Change…').click();
await page.waitForTimeout(500);
await page.getByRole('radio', { name: 'Rec. 2100 PQ (HDR10)' }).click();
await page.screenshot({ path: `${dir}/hdr-dialog.png` });
await page.getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${dir}/hdr-edit.png` });
// Color page with scopes.
await page.getByRole('button', { name: 'Color', exact: true }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${dir}/hdr-color.png` });
console.log(logs.join('\n'));
await browser.close();
