const {chromium}=require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
for (const [w,h] of [[1920,1020],[1440,900]]){
const p=await b.newPage({viewport:{width:w,height:h}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:1420/');await p.waitForTimeout(500);
await p.getByRole('button',{name:'Add input'}).first().click();await p.getByRole('button',{name:/^Microphone/}).click();await p.waitForTimeout(700);await p.locator('.addinput__list .seg').first().click();await p.getByRole('dialog').getByRole('button',{name:'Add input'}).click();await p.waitForTimeout(300);
const f=p.getByRole('slider',{name:/Fake Audio Input 1 level/});const val=()=>f.getAttribute('aria-valuenow');
const hb=await p.locator('.strip').first().locator('.fader__handle').boundingBox();
await p.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2);await p.mouse.down();await p.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2+60,{steps:6});await p.mouse.up();await p.waitForTimeout(100);
const down=await val();
const hb2=await p.locator('.strip').first().locator('.fader__handle').boundingBox();
await p.mouse.move(hb2.x+hb2.width/2,hb2.y+hb2.height/2);await p.mouse.down();await p.mouse.move(hb2.x+hb2.width/2,hb2.y-30,{steps:6});await p.mouse.up();await p.waitForTimeout(100);
const up=await val();
const tb=await p.locator('.strip').first().locator('.fader__track').boundingBox();await p.mouse.click(tb.x+3,tb.y+tb.height*0.75);await p.waitForTimeout(100);const jump=await val();
await f.dblclick();await p.waitForTimeout(100);const zero=await val();
await f.focus();await p.keyboard.press('ArrowDown');await p.keyboard.press('ArrowDown');await p.waitForTimeout(100);const key=await val();
console.log(w,'start 100 → dragged down:',down,'→ dragged up:',up,'→ clicked low on track:',jump,'→ double-click:',zero,'→ 2× arrow down:',key);
await p.locator('.mixer').screenshot({path:`shots/fader-${w}.png`});console.log('errors',errs);await p.close();}
await b.close();})();
