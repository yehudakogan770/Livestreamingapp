const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto('http://localhost:8766/',{waitUntil:'commit'});
for (const t of [700,1200,1700,3000]){await p.waitForTimeout(t===700?700:500);await p.screenshot({path:process.argv[2]+'/anim-'+t+'.png'});}
await b.close();})();
