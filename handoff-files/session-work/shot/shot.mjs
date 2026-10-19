import { chromium } from 'playwright';
const [, , outDir, ...only] = process.argv;
const url = 'http://localhost:5277/';
const sizes = [
  [1920, 1040],
  [1366, 768],
];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const scenes = (await import('./scenes.mjs?' + Date.now())).default;
for (const [w, h] of sizes) {
  if (process.env.ONE && w !== 1920) continue;
  if (process.env.SMALL && w !== 1366) continue;
  for (const sc of scenes) {
    if (only.length && !only.includes(sc.name)) continue;
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('ERR', sc.name, e.message));
    // Screenshots only: sign-in is switched off by intercepting the auth config (never committed).
    await page.route('**/src/auth/config.ts*', (r) =>
      r.fulfill({ contentType: 'application/javascript', body: "export const AUTH_URL='';export const AUTH_KEY='';export const authOn=()=>false;" }),
    );
    await page.goto(url + (sc.query ?? '?demo'), { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    try {
      if (sc.run) await sc.run(page);
    } catch (e) {
      console.log('scene fail', sc.name, e.message.split('\n')[0]);
    }
    await page.waitForTimeout(700);
    try { await page.screenshot({ path: `${outDir}/${sc.name}-${w}x${h}.png` }); } catch (e) { console.log('shot fail', sc.name, e.message.split('\n')[0]); }
    await ctx.close();
  }
}
await browser.close();
