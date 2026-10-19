const {chromium}=require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:1440,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:1420/');await p.waitForTimeout(600);await p.getByRole('button',{name:'Skip for now'}).click();
const add=async(kind,sw)=>{await p.getByRole('button',{name:'Add input'}).first().click();await p.getByRole('button',{name:new RegExp('^'+kind)}).click();if(sw)await p.getByRole('button',{name:sw}).click();await p.getByRole('dialog').getByRole('button',{name:'Add input'}).click();await p.waitForTimeout(100);};
await add('Colour','#0b2545');await add('Test pattern');await add('Colour','#3b1c32');await add('Countdown');
for (const n of ['Opening','Welcome','Speaker']) {await p.getByRole('button',{name:'+ Add',exact:true}).click();const d=p.getByRole('dialog');await d.getByPlaceholder('e.g. Speaker').fill(n);await d.locator('.pe__input').nth(1).click();await d.locator('.pe__input').nth(0).click();
 if(n==='Speaker'){await d.getByRole('button',{name:'+ Add button'}).click();await d.getByLabel('Add step').selectOption('cutTo');await d.getByLabel('Add step').selectOption('wait');await d.getByLabel('Add step').selectOption('monitorMessage');await p.screenshot({path:'shots/pe.png'});}
 await d.getByRole('button',{name:'Create preset'}).click();await p.waitForTimeout(100);}
await p.getByRole('button',{name:'Next ▶'}).click();await p.getByRole('button',{name:'Next ▶'}).click();await p.getByRole('button',{name:'Next ▶'}).click();await p.waitForTimeout(200);
await p.screenshot({path:'shots/presets.png'});
await p.getByRole('button',{name:'Event'}).click();await p.waitForTimeout(100);await p.screenshot({path:'shots/eventmenu.png',clip:{x:0,y:0,width:500,height:260}});
console.log('errors',errs);await b.close();})();
