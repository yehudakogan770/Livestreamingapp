const { chromium } = require('playwright-core');
const svg = (c1, c2, label, w = 1200, h = 800) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w/2}" cy="${h/2}" r="${h/4}" fill="#fff8"/><text x="50%" y="90%" font-size="60" text-anchor="middle" fill="#fff">${label}</text></svg>`);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1000, height: 600 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:1420');
  const msgs = [
    { id: 1, name: 'Sarah Levi', text: 'Mazel tov to the chatan and kallah! May you build a bayit ne’eman b’Yisrael.', photo: '', at: 1, approved: true },
    { id: 2, name: 'The Cohen family', text: 'Wishing you a lifetime of happiness together', photo: svg('#e0473b', '#f2b233', 'Wedding'), at: 2, approved: true },
    { id: 3, name: 'David', text: '', photo: svg('#2f80ed', '#27ae60', 'Dancing', 800, 1000), at: 3, approved: true },
    { id: 5, name: 'Miriam K.', text: 'So happy for you both ❤️', photo: '', at: 5, approved: true },
  ];
  const qr = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/><rect x="5" y="5" width="5" height="5"/></svg>';
  const base = { type: 'wall', title: 'Messages for Chaim & Rivka', prompt: 'Write a blessing for the couple', messages: msgs, open: true, photos: true, autoApprove: false, style: 'cards', seconds: 8, pinned: null, nextId: 5, joinUrl: 'http://192.168.1.20:8787/vote', joinQr: qr, showJoin: true };
  const shots = [['r-card-photo', { pinned: 2 }], ['r-card-only', { pinned: 3 }], ['r-card-text', { pinned: 1, showJoin: false }], ['r-grid', { style: 'grid' }], ['r-ticker', { style: 'ticker' }]];
  for (const [name, patch] of shots) {
    const url = await p.evaluate(async (k) => {
      const { ProgramCompositor } = await import('/src/broadcast/compositor.ts');
      const c = new ProgramCompositor({ mediaUrl: (x) => x }, 1920, 1080);
      const draw = () => { c.ctx.fillStyle = '#444'; c.ctx.fillRect(0, 0, 1920, 1080); c.wall(k, 1000, 1920, 1080); };
      draw(); await new Promise((r) => setTimeout(r, 400)); draw();
      return c.canvas.toDataURL('image/png');
    }, { ...base, ...patch });
    require('fs').writeFileSync(name + '.png', Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log('errors', errs);
  await b.close();
})();
