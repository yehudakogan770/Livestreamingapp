const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
for (const [n,u] of [['older','http://localhost:8799/'],['current','http://localhost:8765/']]){const p=await b.newPage({viewport:{width:1440,height:900}});await p.goto(u);await p.waitForTimeout(1500);await p.screenshot({path:process.argv[2]+'/site-'+n+'.png'});}
await b.close();})();
