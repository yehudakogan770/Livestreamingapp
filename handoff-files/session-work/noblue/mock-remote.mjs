// Stand-in for Lumora's remote server: phone remote + speaker slides pages.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
const dir = process.argv[2];
const port = Number(process.argv[3] ?? 18991);
const showFile = process.argv[4];
const titles = ['Welcome to the Spring Gala', 'Our year in numbers', 'Students reached', 'A new library wing', 'Meet our volunteers', 'Video', 'Scholarships', 'What comes next', 'How you can help', 'Thank you'];
const slides = titles.map((t, i) => (i === 5 ? { type: 'input', name: 'Camp video' } : { type: 'image', v: `s${i}`, ...(i === 2 ? { notes: 'Story: Maya from Lincoln Elementary read her first book this year.' } : {}) }));
const view = { event: 'Spring Gala 2026', locked: false, allowBlack: true, slideshows: [{ id: 'talk', name: 'Gala slides', onAir: 'live', inNext: false, current: 2, black: false, looping: false, slides }], countdown: { name: 'Program ends', endsAt: Date.now() + 23 * 60_000 + 41_000, remainingMs: 0 } };
const pic = (i) => `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#f6f4ef"/><text x="140" y="520" font-family="Georgia" font-size="110" fill="#1d2430">${titles[i] ?? ''}</text></svg>`;
const T = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json' };
createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname === '/' ? '/index.html' : url.pathname === '/slides' ? '/slides.html' : url.pathname === '/vote' ? '/vote.html' : url.pathname;
  if (!p.startsWith('/api') && existsSync(dir + p)) {
    res.writeHead(200, { 'Content-Type': T[p.split('.').pop()] ?? 'application/octet-stream' });
    return res.end(readFileSync(dir + p));
  }
  if (p === '/banks.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"banks":[]}');
  }
  if (p === '/api/check') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"access":"operator"}');
  }
  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const show = JSON.parse(readFileSync(showFile, 'utf8'));
    res.write(`event: show\ndata: ${JSON.stringify({ now: Date.now(), snapshot: { show } })}\n\n`);
    res.write(`event: slides\ndata: ${JSON.stringify({ now: Date.now(), view })}\n\n`);
    return;
  }
  if (p === '/api/slide-picture') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    return res.end(pic(Number(url.searchParams.get('n'))));
  }
  if (p === '/api/action') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{}');
  }
  res.writeHead(404);
  res.end();
}).listen(port, () => console.log('mock on ' + port));
