const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:1024,height:1024}});
await p.goto('file://'+process.argv[2]);await p.screenshot({path:process.argv[3],omitBackground:true});await b.close();})();
