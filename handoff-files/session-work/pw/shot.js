const { chromium } = require('playwright-core');
const out = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto('http://localhost:8765/titler/');
  await p.waitForSelector('[data-testid=titler-library]');
  await p.waitForTimeout(800);
  await p.screenshot({ path: out + 'titler-library.png' });
  await p.click('text=Name and role');
  await p.waitForTimeout(500);
  // Select the name layer in the timeline.
  await p.locator('[data-testid=titler-timeline] .tt-name', { hasText: /^Name$/ }).first().click();
  await p.keyboard.press('u');
  await p.waitForTimeout(600);
  await p.screenshot({ path: out + 'titler-designer.png' });
  // The graph editor on the name's opacity.
  await p.locator('[data-testid=titler-timeline] .tt-propname', { hasText: 'Opacity' }).first().click();
  await p.click('text=Graph editor');
  await p.waitForTimeout(300);
  await p.screenshot({ path: out + 'titler-graph.png' });
  await p.click('text=Timeline');
  // Scoreboard template with fields tab.
  await p.click('.tt-tabs >> text=Library');
  page2: {
    await p.click('text=Scoreboard bar');
    await p.waitForTimeout(500);
    await p.click('.tt-tabs >> text=Fields');
    await p.waitForTimeout(400);
    await p.screenshot({ path: out + 'titler-fields.png' });
  }
  console.log('errors:', errors.slice(0, 10));
  await b.close();
})();
