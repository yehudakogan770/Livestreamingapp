// A stand-in for Lumora's remote server, for screenshots of the slides page.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const dir = process.argv[2];
const port = Number(process.argv[3] ?? 18990);

const titles = [
  ['Welcome to the Spring Gala', 'Thank you for joining us tonight'],
  ['Our year in numbers', ''],
  ['Students reached', '1,240 children in 14 schools'],
  ['A new library wing', 'Opening in September'],
  ['Meet our volunteers', ''],
  ['Video: a day at camp', ''],
  ['Scholarships', '62 families helped this year'],
  ['What comes next', 'Three goals for 2027'],
  ['How you can help', 'Every gift is matched tonight'],
  ['Thank you', ''],
];
const notes = {
  0: 'Welcome everyone. Thank the board and the sponsors at table 1.\nMention that dinner is served right after the program.',
  1: 'Pause here for the applause. The chart builds by itself.',
  2: 'Story: Maya from Lincoln Elementary read her first book this year.',
  7: 'Keep this short: about one minute.',
  8: 'Point to the cards on the tables. The pledge page is on the screen next.',
};
const slides = titles.map((t, i) =>
  i === 5 ? { type: 'input', name: 'Camp video' } : { type: 'image', v: `s${i}`, ...(notes[i] ? { notes: notes[i] } : {}) },
);
const view = {
  event: 'Spring Gala 2026',
  locked: false,
  allowBlack: true,
  slideshows: [{ id: 'talk', name: 'Gala slides', onAir: 'live', inNext: false, current: 2, black: false, looping: false, slides }],
  countdown: { name: 'Program ends', endsAt: Date.now() + 23 * 60_000 + 41_000, remainingMs: 0 },
};

function picture(i) {
  const [title, sub] = titles[i] ?? ['', ''];
  const bars =
    i === 1
      ? [40, 70, 55, 90, 120]
          .map((h, j) => `<rect x="${560 + j * 150}" y="${860 - h * 4}" width="100" height="${h * 4}" fill="#1f6f79"/>`)
          .join('')
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
<rect width="1920" height="1080" fill="#f6f4ef"/>
<rect x="0" y="0" width="1920" height="24" fill="#1f6f79"/>
<text x="140" y="${bars ? 260 : 470}" font-family="Georgia, serif" font-size="110" fill="#1d2430">${title}</text>
<text x="140" y="${bars ? 360 : 580}" font-family="Helvetica, Arial, sans-serif" font-size="56" fill="#5a6270">${sub}</text>
${bars}
<text x="1780" y="1030" font-family="Helvetica, Arial, sans-serif" font-size="36" fill="#9aa0a8" text-anchor="end">${i + 1}</text>
</svg>`;
}

const files = {
  '/slides': ['slides.html', 'text/html'],
  '/slides.js': ['slides.js', 'text/javascript'],
  '/slides-core.js': ['slides-core.js', 'text/javascript'],
  '/slides.css': ['slides.css', 'text/css'],
};
const streams = new Set();
const push = () => {
  for (const s of streams) s.write(`event: slides\ndata: ${JSON.stringify({ now: Date.now(), view })}\n\n`);
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const f = files[url.pathname];
  if (f) {
    res.writeHead(200, { 'Content-Type': f[1] });
    return res.end(readFileSync(`${dir}/${f[0]}`));
  }
  if (url.pathname === '/api/check') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"access":"speaker"}');
  }
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    streams.add(res);
    req.on('close', () => streams.delete(res));
    return push();
  }
  if (url.pathname === '/api/slide-picture') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    return res.end(picture(Number(url.searchParams.get('n'))));
  }
  if (url.pathname === '/api/action') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const a = JSON.parse(body);
      const sh = view.slideshows[0];
      if (a.type === 'slideNext') sh.current = Math.min(sh.slides.length - 1, sh.current + 1);
      if (a.type === 'slidePrevious') sh.current = Math.max(0, sh.current - 1);
      if (a.type === 'slideGo') sh.current = a.index;
      if (a.type === 'slideBlack') sh.black = a.value;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      push();
    });
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(port, () => console.log(`mock on ${port}`));
