const {chromium}=require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto('http://localhost:8765/BackLoops.dc.html');await p.waitForTimeout(1500);
console.log(await p.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+2&&e.clientHeight>0&&getComputedStyle(e).overflowY!=='auto').map(e=>e.tagName+' '+e.clientHeight+'/'+e.scrollHeight+' '+(e.getAttribute('style')||'').slice(0,160)+' | parent:'+(e.parentElement.getAttribute('style')||'').slice(0,100)).join('\n')));await b.close();})();
