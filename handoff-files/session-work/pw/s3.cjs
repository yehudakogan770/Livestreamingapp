const { start } = require('./lib.cjs');
(async () => {
  const url = process.argv[2] || 'http://localhost:1532/titler/';
  const { b, p, shot, flush } = await start(url);
  await p.click('text=Name and role');
  await p.waitForTimeout(600);
  // select Name via timeline
  await p.click('.tt-timeline .tt-name:text-is("Name")');
  await p.waitForTimeout(200);
  await shot('k1-sel');
  // expand properties
  await p.click('.tt-row.layer.sel .tt-ico >> nth=0');
  await p.waitForTimeout(200);
  await shot('k2-open');
  flush('open props');
  // Rotation stopwatch in timeline
  const rot = p.locator('.tt-row.prop', { hasText: 'Rotation' }).first();
  await rot.locator('button[aria-label="Animate Rotation"]').click();
  await p.waitForTimeout(200);
  // move playhead to 3s via ruler click
  const ruler = await p.$('.tt-tl-ruler');
  const rb = await ruler.boundingBox();
  await p.mouse.click(rb.x + 3 * 120 + 1, rb.y + 10);
  await p.waitForTimeout(200);
  const inp = rot.locator('input').first();
  await inp.click();
  await inp.fill('45');
  await inp.press('Enter');
  await p.waitForTimeout(300);
  await shot('k3-key');
  console.log('keys on rotation row', await rot.locator('.tt-key').count());
  flush('keyframe');
  // Graph editor
  await p.click('.tt-tl-tabs button:has-text("Graph editor")');
  await p.waitForTimeout(300);
  await shot('k4-graph');
  flush('graph');
  await p.click('.tt-tl-tabs button:has-text("Timeline")');
  // Take IN / OUT
  await p.click('button:has-text("Take IN")');
  await p.waitForTimeout(1500);
  await shot('k5-takein');
  await p.click('button:has-text("Take OUT")');
  await p.waitForTimeout(1500);
  await shot('k6-takeout');
  flush('take');
  // Fields: add a field
  await p.click('.tt-right .tt-tabs button:has-text("Fields")');
  await p.waitForTimeout(200);
  const newLabel = p.locator('input[placeholder^="Label"]');
  await newLabel.fill('Guest title');
  await p.click('button:has-text("Add")');
  await p.waitForTimeout(300);
  await shot('f1-field');
  flush('fields');
  // control panel edit value
  const cp = p.locator('[data-testid=titler-control-panel]');
  if (await cp.count()) {
    const nm = cp.getByLabel('Name');
    await nm.fill('Alex Morgan');
    await p.waitForTimeout(300);
    await shot('f2-cp');
  }
  flush('cp');
  // Data source
  await p.click('.tt-right .tt-tabs button:has-text("Data")');
  await p.click('button:has-text("Add a data source")');
  await p.waitForTimeout(300);
  await shot('d1-data');
  flush('data');
  // Save to library, then New, then open from library
  await p.keyboard.press('Control+s');
  await p.waitForTimeout(500);
  await p.click('.tt-menu button:has-text("New")');
  await p.waitForTimeout(300);
  await p.click('.tt-left .tt-tabs button:has-text("Library")');
  await p.waitForTimeout(400);
  await shot('l1-lib');
  flush('lib');
  // Export HTML
  await p.click('.tt-menu button:has-text("Export")');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }).catch((e) => null), p.click('.tt-modal button.tt-primary')]);
  console.log('download', dl && (await dl.suggestedFilename()));
  await p.waitForTimeout(500);
  await shot('e1-export');
  flush('export');
  await b.close();
})();
