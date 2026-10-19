const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async()=>{
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const S=process.argv[2];
for (const [name,url,full] of [['site','http://localhost:8765/index.html',true],['planner','http://localhost:8765/planner/index.html',false]]) {
  const p = await b.newPage({viewport:{width:1440,height:900}});
  await p.goto(url); await p.waitForTimeout(1500);
  await p.screenshot({path:`${S}/now-${name}.png`, fullPage:full});
}
await b.close();})();
