const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage();
  await p.setContent(`<style>@page{size:1280px 720px;margin:0}div{width:1280px;height:720px;display:flex;align-items:center;justify-content:center;font:bold 120px sans-serif;page-break-after:always}</style>
  <div style="background:#0b2545;color:#fff">Welcome</div><div style="background:#fff;color:#c7372f">Page two</div><div style="background:#2f8f4e;color:#fff">שלום</div>`);
  await p.pdf({ path: 'deck.pdf', width: '1280px', height: '720px', printBackground: true });
  await b.close();
})();
