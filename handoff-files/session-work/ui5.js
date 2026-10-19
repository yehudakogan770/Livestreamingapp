const {chromium}=require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
for (const [w,h] of [[1440,900],[1920,1020]]) {
const p=await b.newPage({viewport:{width:w,height:h}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:1420/');await p.waitForTimeout(600);
const add=async(kind,sw)=>{await p.getByRole('button',{name:'Add input'}).first().click();await p.getByRole('button',{name:new RegExp('^'+kind)}).click();if(sw)await p.getByRole('button',{name:sw}).click();await p.getByRole('dialog').getByRole('button',{name:'Add input'}).click();await p.waitForTimeout(100);};
await add('Colour','#0b2545');await add('Test pattern');await add('Colour','#3b1c32');
await p.locator('.tile__pick').nth(0).dblclick();
await p.getByRole('button',{name:'On Live'}).click();await p.getByRole('button',{name:/^Start$/}).click();await p.waitForTimeout(1300);
await p.screenshot({path:`shots/m5-live-${w}.png`});
const over=await p.evaluate(()=>{const e=document.querySelector('.stage');return [e.scrollHeight,e.clientHeight, document.querySelector('.inputs-area').clientHeight]});console.log(w,'stage/inputs heights',over);
await p.getByRole('button',{name:'Last 10s'}).click();await p.waitForTimeout(400);await p.screenshot({path:`shots/m5-final-${w}.png`,clip:{x:w/2,y:100,width:w/2,height:h/2}});
await p.keyboard.press('F3');await p.waitForTimeout(300);
await p.getByRole('button',{name:'5 minutes left'}).click();await p.waitForTimeout(300);
await p.screenshot({path:`shots/m5-monitor-${w}.png`});
for (const l of ['Message + time below','Side by side']) {await p.getByRole('button',{name:l}).click();await p.waitForTimeout(200);await p.locator('.stage--monitor .mon__screen').screenshot({path:`shots/m5-mon-${l.slice(0,4)}-${w}.png`});}
console.log('errors',errs);await p.close();}
await b.close();})();
