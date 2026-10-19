const {chromium}=require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
const p=await b.newPage({viewport:{width:1440,height:900}});const r404=[];p.on('response',r=>{if(r.status()>=400)r404.push(r.url())});
await p.goto('http://localhost:1420/');await p.waitForTimeout(600);await p.mouse.click(700,500);
await p.getByRole('button',{name:'Add input'}).first().click();await p.getByRole('button',{name:/^Microphone/}).click();await p.waitForTimeout(800);await p.locator('.addinput__list .seg').first().click();
await p.getByRole('dialog').getByRole('button',{name:'Add input'}).click();await p.waitForTimeout(500);
let max=0;for(let i=0;i<40;i++){max=Math.max(max,await p.locator('.meter__bar').first().evaluate(e=>parseFloat(e.style.height)||0));await p.waitForTimeout(50);}
console.log('mic meter max over 2s:',max.toFixed(0)+'%','| db label:',await p.locator('.strip__db').first().innerText());
console.log('404s',r404);await b.close();})();
