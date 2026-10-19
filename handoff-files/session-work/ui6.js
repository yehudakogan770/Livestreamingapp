const {chromium}=require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:1920,height:1020}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:1420/');await p.waitForTimeout(600);await p.keyboard.press('F3');await p.waitForTimeout(200);
await p.getByRole('textbox',{name:'Message'}).fill('start after timer hi hhffghjhdhhthd f f jkhfv jhv jh and a much longer message for the people on stage');await p.keyboard.press('Enter');
await p.getByRole('button',{name:'XL'}).click();
for (const l of ['Full','Message + time below','Side by side']) {await p.getByRole('button',{name:l,exact:true}).click();await p.waitForTimeout(300);
 const r=await p.evaluate(()=>{const t=document.querySelector('.mscreen__message'),bx=document.querySelector('.mscreen__msgbox');const a=t.getBoundingClientRect(),c=bx.getBoundingClientRect();return {font:getComputedStyle(t).fontSize,textBottom:Math.round(a.bottom),boxBottom:Math.round(c.bottom),textTop:Math.round(a.top),boxTop:Math.round(c.top)}});
 console.log(l,r, r.textTop>=r.boxTop-1&&r.textBottom<=r.boxBottom+1?'FITS':'OVERFLOW');
 await p.locator('.stage--monitor .mon__screen').screenshot({path:`shots/fit-${l.slice(0,4)}.png`});}
console.log('errors',errs);await b.close();})();
