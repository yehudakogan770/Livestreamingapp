const { chromium } = require('playwright-core');
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
for (const [f, clip] of [['Main.dc.html',{x:0,y:0,width:700,height:100}],['Website.dc.html',{x:0,y:0,width:700,height:80}],['PhoneRemote.dc.html',{x:0,y:0,width:390,height:70}],['TabletRemote.dc.html',{x:0,y:0,width:600,height:60}]]) {
  await p.goto('http://localhost:8765/'+f); await p.waitForTimeout(1800); await p.screenshot({ path: 'shots/h-'+f+'.png', clip }); }
await b.close(); })();
