const { start } = require('./lib.cjs');
(async () => {
  const { b, p, shot, flush } = await start();
  await shot('home');
  flush('load');
  console.log(await p.evaluate(() => document.body.innerText.slice(0, 3000)));
  await b.close();
})();
