import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(()=>chromium.launch());
const S=process.argv[2];
for (const [name,url,w,h,full] of [['site','file:///home/user/Livestreamingapp/docs/index.html',1440,900,true],['planner','file:///home/user/Livestreamingapp/docs/planner/index.html',1440,900,false]]) {
  const p = await b.newPage({viewport:{width:w,height:h}});
  await p.goto(url); await p.waitForTimeout(1500);
  await p.screenshot({path:`${S}/now-${name}.png`, fullPage:full});
}
await b.close();
