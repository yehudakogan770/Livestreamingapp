const { start, DIR } = require('./lib.cjs');
(async () => {
  const url = process.argv[2] || 'http://localhost:1532/titler/';
  const { b, p, shot, flush } = await start(url);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.tt-menu button:has-text("Import")')]);
  await fc.setFiles(DIR + '/../test.psd');
  await p.waitForTimeout(1500);
  await shot('psd1');
  console.log(await p.textContent('.tt-status'));
  const dlg = await p.$('.tt-modal');
  if (dlg) console.log('dialog:', await dlg.innerText());
  flush('psd');
  await b.close();
})();
