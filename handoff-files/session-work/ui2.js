const {chromium}=require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto('http://localhost:1420/');await p.waitForTimeout(600);
const add=async(kind)=>{await p.getByRole('button',{name:'Add input'}).first().click();await p.getByRole('button',{name:new RegExp('^'+kind)}).click();await p.getByRole('dialog').getByRole('button',{name:'Add input'}).click();await p.waitForTimeout(200);};
await add('Colour');await add('Test pattern');
await p.locator('.tile__pick').nth(0).click();await p.keyboard.press('Shift+Enter');await p.locator('.tile__pick').nth(1).click();
const onair=()=>p.locator('.mon--pgm .mon__head em').innerText();
const t=await p.locator('.tbar__track').boundingBox();
for (const [label,endX] of [['drag to far end',t.x+t.width-1],['drag past end',t.x+t.width+30]]) {
 const st=await p.locator('.tbar__labels span').first().innerText();
 const startX= st==='On air'? t.x+3 : t.x+t.width-3; const goX = st==='On air'? endX : t.x - (endX-(t.x+t.width));
 await p.mouse.move(startX,t.y+t.height/2);await p.mouse.down();await p.mouse.move(goX,t.y+t.height/2,{steps:8});
 console.log(label,'value before release',await p.locator('.tbar__track').getAttribute('aria-valuenow'));
 await p.mouse.up();await p.waitForTimeout(300);
 console.log(' -> on air:',await onair(),'| toasts:',await p.locator('.toast').allInnerTexts(),'| value',await p.locator('.tbar__track').getAttribute('aria-valuenow'),'| left label',await p.locator('.tbar__labels span').first().innerText());
}
await b.close();})();
