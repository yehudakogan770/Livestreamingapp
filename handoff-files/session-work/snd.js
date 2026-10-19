const {chromium}=require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
const p=await b.newPage({viewport:{width:1440,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto('http://localhost:1420/');await p.waitForTimeout(600);
await p.mouse.click(700,500);
const openAdd=async(kind)=>{await p.getByRole('button',{name:'Add input'}).first().click();await p.getByRole('button',{name:new RegExp('^'+kind)}).click();await p.waitForTimeout(500);};
// music
await openAdd('Sound');const [fc]=await Promise.all([p.waitForEvent('filechooser'),p.getByRole('button',{name:'Choose file…'}).click()]);await fc.setFiles('tone.wav');await p.waitForTimeout(300);
await p.getByRole('dialog').getByRole('button',{name:'Add input'}).click();await p.waitForTimeout(300);
// mic
await openAdd('Microphone');await p.waitForTimeout(800);console.log('mics:',await p.locator('.addinput__list .seg').allInnerTexts());await p.locator('.addinput__list .seg').first().click();
await p.getByRole('dialog').getByRole('button',{name:'Add input'}).click();await p.waitForTimeout(300);
console.log('tiles:',await p.locator('.tile__name').allInnerTexts(),'| strips:',await p.locator('.strip__name').allInnerTexts());
const meter=async(i)=>p.locator('.meter__bar').nth(i).evaluate(e=>parseFloat(e.style.height)||0);
await p.getByRole('button',{name:/^Play /}).click();await p.waitForTimeout(1500);
console.log('playing: music meter',(await meter(0)).toFixed(0)+'%','mic meter',(await meter(1)).toFixed(0)+'%','stream meter',(await meter(2)).toFixed(0)+'%');
await p.waitForTimeout(4600);await p.screenshot({path:'shots/mixer.png'});const clip=await p.evaluate(()=>{const m=document.querySelector('.mixer__strips');return [m.scrollHeight,m.clientHeight]});console.log('strips scroll/client',clip,'toasts',await p.locator('.toast').allInnerTexts());
await p.locator('.strip').first().getByRole('button',{name:'M',exact:true}).click();await p.waitForTimeout(800);
console.log('music muted: music meter',(await meter(0)).toFixed(0)+'%');
await p.locator('.strip').first().getByRole('button',{name:'M',exact:true}).click();
await p.locator('.strip').first().getByRole('button',{name:'A',exact:true}).click();await p.waitForTimeout(800);
console.log('music set to follow video (not on air): music meter',(await meter(0)).toFixed(0)+'%');
await p.getByRole('button',{name:'Speakers…'}).click();await p.waitForTimeout(800);await p.screenshot({path:'shots/speakers.png'});
console.log('errors',errs);await b.close();})();
