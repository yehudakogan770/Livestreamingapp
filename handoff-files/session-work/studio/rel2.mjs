const url = process.argv[2];
const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
const t = await r.text();
console.log(r.status, r.url);
const links = [...t.matchAll(/href="([^"]*releases\/download[^"]*)"/g)].map((m) => m[1]);
console.log([...new Set(links)].join('\n'));
if (!links.length) console.log(t.slice(0, 500));
