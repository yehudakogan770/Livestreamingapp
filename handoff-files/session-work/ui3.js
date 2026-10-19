const {chromium}=require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:1440,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:1420/');await p.waitForTimeout(600);await p.getByRole('button',{name:'Skip for now'}).click();
const add=async(kind,sw)=>{await p.getByRole('button',{name:'Add input'}).first().click();await p.getByRole('button',{name:new RegExp('^'+kind)}).click();if(sw)await p.getByRole('button',{name:sw}).click();await p.getByRole('dialog').getByRole('button',{name:'Add input'}).click();await p.waitForTimeout(150);};
await add('Colour','#c7372f');await add('Test pattern');await add('Colour','#1f6f79');
const tile=i=>p.locator('.tile__pick').nth(i);
await tile(0).click();await p.keyboard.press('Shift+Enter');
// each transition: sample the program box mid-way
for (const k of ['Fade','Merge','Dip','Wipe','Slide']) {
  await p.getByRole('radio',{name:k,exact:true}).click();await p.getByRole('radio',{name:'2s',exact:true}).click();
  await tile(k==='Fade'||k==='Dip'||k==='Slide'?1:2).click().catch(()=>{});
  const pv=await p.locator('.mon--pvw .mon__head em').innerText();
  await p.getByRole('button',{name:/^TAKE/}).click();await p.waitForTimeout(950);
  const layers=await p.locator('.mon--pgm [data-layer]').evaluateAll(ls=>ls.map(l=>`${l.dataset.layer}:op=${(+getComputedStyle(l).opacity).toFixed(2)}${l.style.clipPath?' clip='+l.style.clipPath:''}${l.style.transform?' '+l.style.transform:''}`));
  const black=await p.locator('.mon--pgm [data-screen] > div:not([data-layer])').evaluateAll(ls=>ls.map(l=>(+l.style.opacity).toFixed(2)));
  await p.screenshot({path:`shots/tr-${k}.png`,clip:{x:848,y:130,width:584,height:332}});
  await p.waitForTimeout(1300);
  console.log(k.padEnd(6),'mid:',layers.join(' | '),black.length?'black '+black:'', '→ on air',await p.locator('.mon--pgm .mon__head em').innerText(),'(was next:',pv+')');
}
// blank + panic
await p.getByRole('button',{name:'Live',exact:true}).click();await p.waitForTimeout(400);
console.log('blank overlay live:',await p.locator('.mon--pgm [data-blank]').count(), await p.getByRole('tab',{name:/Live Screen/}).innerText());
await p.getByRole('button',{name:'Live',exact:true}).click();
await p.getByRole('button',{name:'PANIC'}).click();console.log('panic hint:',await p.locator('.btn--panic').innerText());
await p.getByRole('button',{name:/Double-click/}).dblclick();await p.waitForTimeout(400);console.log('panic:',await p.locator('.btn--panic').innerText(),'| tabs',(await p.locator('.selector__badge').allInnerTexts()).join(','));
await p.screenshot({path:'shots/app-panic.png'});
await p.locator('.btn--panic').click();await p.waitForTimeout(400);console.log('after undo:',(await p.locator('.selector__badge').allInnerTexts()).join(','));
// back = live
await p.getByRole('button',{name:'Back = Live'}).click();await p.keyboard.press('F2');await p.waitForTimeout(900);
console.log('back tab on air:',await p.locator('.mon--pgm .mon__head em').innerText(),'| follow flag',await p.locator('.mon__follow').count());
await p.screenshot({path:'shots/app-back.png'});
// take on back breaks following
await tile(2).click();await p.keyboard.press('Shift+Enter');await p.waitForTimeout(200);
console.log('after manual back cut, following:',await p.getByRole('button',{name:'Back = Live'}).getAttribute('aria-pressed'));
// monitor
await p.keyboard.press('F3');await p.waitForTimeout(300);await p.getByRole('button',{name:'Flash to get attention'}).click();await p.waitForTimeout(200);
await p.screenshot({path:'shots/app-monitor.png'});
await p.keyboard.press('F1');
// menu
await p.getByRole('button',{name:'Options for Colour'}).first().click();await p.locator('.menu input').first().fill('Stage red');await p.keyboard.press('Enter');await p.waitForTimeout(200);
console.log('renamed:',(await p.locator('.tile__name').allInnerTexts()).join(','));
await p.getByRole('button',{name:'Options for Test pattern'}).click();await p.getByRole('button',{name:'Remove input'}).click();await p.getByRole('button',{name:'Click again to remove'}).click();await p.waitForTimeout(200);
console.log('after remove:',(await p.locator('.tile__name').allInnerTexts()).join(','));
// outputs dialog
await p.getByRole('button',{name:/^Outputs/}).click();await p.waitForTimeout(300);await p.screenshot({path:'shots/app-outputs.png'});
await p.getByRole('button',{name:'Open',exact:true}).first().click();await p.waitForTimeout(300);console.log('demo open toast:',await p.locator('.toast').allInnerTexts());
await p.keyboard.press('Escape');
// output page
const o=await b.newPage({viewport:{width:960,height:540}});await o.goto('http://localhost:1420/?output=monitor');await o.waitForTimeout(500);await o.screenshot({path:'shots/out-monitor.png'});
console.log('errors',errs);await b.close();})();
