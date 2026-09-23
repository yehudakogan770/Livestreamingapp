const { chromium } = require('playwright-core');
const fs = require('fs');
const files = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage({ viewport: { width: 1500, height: 2700 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  for (const f of files) {
    errs.length = 0;
    await p.goto('http://localhost:8765/' + f);
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => {
      const root = document.querySelector('#dc-root');
      if (!root) return { err: 'no root' };
      const art = root.querySelector('div');
      if (!art) return { err: 'empty' };
      const R = art.getBoundingClientRect();
      const lab = (el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
      const out = { clip: [], overlap: [], outside: [] };
      const all = art.querySelectorAll('*');
      for (const el of all) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (['svg','path','rect','circle','INPUT','SELECT','TEXTAREA','OPTION'].includes(el.tagName) || el instanceof SVGElement) continue;
        // text clipping / spilling
        if (el.children.length === 0 && el.textContent.trim() && cs.textOverflow !== 'ellipsis') {
          if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) out.clip.push(lab(el) + ` (${el.scrollWidth}>${el.clientWidth})`);
        }
        // children overlap in flow
        const kids = [...el.children].filter(k => { const c = getComputedStyle(k); return c.position !== 'absolute' && c.position !== 'fixed' && c.display !== 'none' && k.getBoundingClientRect().width > 0; });
        for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].getBoundingClientRect(), c = kids[j].getBoundingClientRect();
          const ix = Math.min(a.right, c.right) - Math.max(a.left, c.left), iy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
          if (ix > 2 && iy > 2) out.overlap.push(lab(kids[i]) + ' ⟂ ' + lab(kids[j]));
        }
        // container overflow (content bigger than a fixed box)
        if (el.children.length && cs.overflow === 'visible' && el.scrollHeight > el.clientHeight + 3 && el.clientHeight > 0 && cs.display !== 'inline') out.clip.push('[box overflow Y] ' + lab(el).slice(0,30) + ` (${el.scrollHeight}>${el.clientHeight})`);
        if (el.children.length && cs.overflow === 'visible' && el.scrollWidth > el.clientWidth + 3 && el.clientWidth > 0 && cs.display !== 'inline') out.clip.push('[box overflow X] ' + lab(el).slice(0,30) + ` (${el.scrollWidth}>${el.clientWidth})`);
        if (el.children.length && (cs.overflow === 'hidden' || cs.overflowY === 'hidden') && el.scrollHeight > el.clientHeight + 3 && el.clientHeight > 20) out.clip.push('[HIDDEN Y] ' + lab(el).slice(0,40) + ` (${el.scrollHeight}>${el.clientHeight})`);
        if (el.children.length && (cs.overflow === 'hidden' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 3 && el.clientWidth > 20 && cs.textOverflow !== 'ellipsis') out.clip.push('[HIDDEN X] ' + lab(el).slice(0,40) + ` (${el.scrollWidth}>${el.clientWidth})`);
        const e = el.getBoundingClientRect();
        if (e.width && (e.right > R.right + 1 || e.bottom > R.bottom + 1)) out.outside.push(lab(el));
      }
      out.clip = [...new Set(out.clip)]; out.overlap = [...new Set(out.overlap)]; out.outside = [...new Set(out.outside)];
      return out;
    });
    await p.screenshot({ path: 'shots/' + f.replace('.dc.html', '.png'), fullPage: false });
    console.log('== ' + f, errs.length ? 'ERR ' + errs[0].slice(0,150) : '', JSON.stringify({ clip: r.clip?.length, overlap: r.overlap?.length, outside: r.outside?.length, err: r.err }));
    for (const k of ['clip', 'overlap', 'outside']) (r[k] || []).slice(0, 30).forEach(x => console.log('   ' + k + ': ' + x));
  }
  await b.close();
})();
