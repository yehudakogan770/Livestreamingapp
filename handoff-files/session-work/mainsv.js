const {chromium}=require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});const p=await b.newPage({viewport:{width:1440,height:900}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/Main.dc.html');await p.waitForTimeout(1500);
const ovf=()=>p.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(e.scrollWidth>e.clientWidth+2)&&getComputedStyle(e).overflowX!=='auto'&&e.tagName!=='SELECT'&&e.tagName!=='INPUT'&&!(e instanceof SVGElement)}).map(e=>e.tagName+' '+e.clientWidth+'/'+e.scrollWidth+' '+(e.innerText||e.tagName).slice(0,50).replace(/\n/g,' ')));
const bpm=()=>p.evaluate(()=>[...document.querySelectorAll('span')].find(s=>/^\d{2,3}$/.test(s.innerText)&&s.style.fontFamily.includes('Consolas'))?.innerText);

await p.getByText('Back Screen',{exact:true}).first().click();await p.waitForTimeout(300);
console.log('back view strip:', await p.evaluate(()=>document.body.innerText.includes('Stage visuals')), 'overflow:', await ovf());
await p.screenshot({path:'shots/main-back0.png'});console.log('bpm', await bpm()); await p.getByLabel('Faster').first().click(); console.log('bpm+', await bpm());
await p.locator('button').filter({hasText:/^Tap$/}).first().click();await p.waitForTimeout(500);await p.locator('button').filter({hasText:/^Tap$/}).first().click();await p.waitForTimeout(100);console.log('tap bpm', await bpm());
await p.locator('button').filter({hasText:/^Blackout$/}).first().click();
await p.screenshot({path:'shots/main-back.png'});
await p.locator('button').filter({hasText:/^All three/}).first().click();await p.waitForTimeout(400);
console.log('all overflow:', await ovf());
await p.screenshot({path:'shots/main-all.png'});
console.log('errors',errs);await b.close();})();
