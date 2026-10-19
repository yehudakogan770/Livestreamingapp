const { chromium } = require('playwright-core');
const svg = (c1, c2, label, w = 1200, h = 900) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w/2}" cy="${h/2}" r="${h/4}" fill="#fff8"/></svg>`);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:1420');
  const qr = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/><rect width="5" height="5"/></svg>';
  const now = Date.now();
  const base = { type: 'auction', title: 'Chinese auction', currency: '$', current: 0, open: true, endsAt: now + 42000, lastBidAt: 0, soldAt: 0, nextId: 9, joinUrl: 'http://192.168.1.20:8765/vote', joinQr: qr, showJoin: true,
    items: [{ id: 1, name: 'Silver Kiddush cup', detail: 'Donated by the Levi family', photo: svg('#8e9eab', '#eef2f3'), start: 180, step: 18, bids: [{ id: 3, name: 'Sarah Levi', amount: 250, at: 1 }], sold: false }, { id: 2, name: 'A week in Jerusalem', detail: '', photo: '', start: 1000, step: 100, bids: [], sold: false }] };
  const cases = [['a-live', {}], ['a-sold', { endsAt: null, soldAt: now - 4000, items: base.items.map((x, i) => (i ? x : { ...x, sold: true })) }]];
  for (const [name, patch] of cases) {
    const k = { ...base, ...patch };
    // the DOM view
    await p.evaluate(async (k) => {
      const React = await import('/node_modules/.vite/deps/react.js');
      const { createRoot } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { AuctionView } = await import('/src/components/AudienceViews.tsx');
      document.body.innerHTML = '<div id="x" style="position:fixed;inset:0;z-index:99"></div>';
      createRoot(document.getElementById('x')).render(React.createElement(AuctionView, { a: k, url: (x) => x }));
    }, k).catch((e) => errs.push('dom ' + e.message));
    await p.waitForTimeout(600);
    await p.screenshot({ path: name + '-dom.png' });
    const url = await p.evaluate(async (k) => {
      const { ProgramCompositor } = await import('/src/broadcast/compositor.ts');
      const c = new ProgramCompositor({ mediaUrl: (x) => x }, 1920, 1080);
      const draw = () => c.auction(k, Date.now(), 1920, 1080);
      draw(); await new Promise((r) => setTimeout(r, 400)); draw();
      return c.canvas.toDataURL('image/png');
    }, k);
    require('fs').writeFileSync(name + '-rec.png', Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log('errors', errs);
  await b.close();
})();
