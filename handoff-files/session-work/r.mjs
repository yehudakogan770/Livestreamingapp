import { chromium } from '/tmp/claude-0/pw-design/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 320, height: 200 }, deviceScaleFactor: 2 });
await p.goto('file:///tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/r.html'); await p.screenshot({ path: '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/r.png' }); await b.close();
