const {chromium}=require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
for(const f of ['old','new']){const p=await b.newPage({viewport:{width:1280,height:800}});const errs=[];
p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto('http://localhost:8766/'+f+'.html');await p.waitForTimeout(3000);
await p.screenshot({path:'shots/sv-'+f+'.png'});console.log(f,'errors:',errs);await p.close();}
await b.close();})();
