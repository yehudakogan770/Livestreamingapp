const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
for (const w of [1920,1600,1366,1280]){const p=await b.newPage({viewport:{width:w,height:800}});
await p.goto('http://localhost:1431/');await p.waitForTimeout(4000);
await p.screenshot({path:process.argv[2]+'/tb-'+w+'.png',clip:{x:0,y:0,width:w,height:42}});await p.close();}
await b.close();})();
