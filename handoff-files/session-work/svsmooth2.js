const {chromium}=require('playwright-core');
const init=()=>{let T=1000;performance.now=()=>T;let cbs=[];window.requestAnimationFrame=cb=>{cbs.push(cb);return 1;};
 const sm=document.createElement('canvas');sm.width=96;sm.height=54;const sx=sm.getContext('2d',{willReadFrequently:true});let prev=null;
 window.__step=(ms)=>{T+=ms;const c=cbs;cbs=[];c.forEach(f=>f(T));const cv=document.querySelector('#preview canvas')||document.querySelector('canvas');
  sx.drawImage(cv,0,0,96,54);const d=sx.getImageData(0,0,96,54).data;let s=0;if(prev){for(let i=0;i<d.length;i+=4)s+=Math.abs(d[i]-prev[i])+Math.abs(d[i+1]-prev[i+1])+Math.abs(d[i+2]-prev[i+2]);}
  prev=d;return s/(96*54*3);};};
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
for(const f of ['old','new']){const p=await b.newPage({viewport:{width:1280,height:800}});await p.addInitScript(init);
 await p.goto('http://localhost:8766/'+f+'.html');await p.waitForTimeout(1500);await p.locator('button').filter({hasText:/^Slow/}).first().click();await p.evaluate(()=>{for(let i=0;i<5;i++)__step(1000/60)});await p.locator('button').filter({hasText:/^Slow/}).first().click();
 const run=async(n)=>{const r=[];for(let i=0;i<n;i++)r.push(await p.evaluate(()=>__step(1000/60)));return r;};
 await p.evaluate(()=>__step(1000/60)); await p.evaluate(()=>__step(20*60*1000)); // 20 minutes into the event
 await run(3); const base=await run(20); const avg=base.reduce((a,b)=>a+b)/base.length;
 await p.evaluate(()=>{for(let i=0;i<400;i++)__step(1000/60)}); const base2=await run(5); await p.selectOption('#speed','2'); const sp=await run(3); const after=await run(8);
 await run(10); await p.selectOption('#pal',{index:3}); const pl=await run(3);
 console.log(f.padEnd(4),'normal frame change',avg.toFixed(2),'| before',base2.map(x=>x.toFixed(1)).join(' '),'| speed switch',sp.map(x=>x.toFixed(1)).join(' '),'| after',after.slice(-3).map(x=>x.toFixed(1)).join(' '),'| colour switch',pl.map(x=>x.toFixed(1)).join(' '));
 await p.close();}
await b.close();})();
