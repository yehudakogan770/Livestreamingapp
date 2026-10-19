// Serves <docs dir> at /Livestreamingapp/ (and /) like GitHub Pages. If <docs>/../.sw-bump exists, sw.js gets a different comment (a "new version").
const http = require('http');
const fs = require('fs');
const path = require('path');
const [, , root, port, bumpFile] = process.argv;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/Livestreamingapp/, '');
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      return res.end('nope');
    }
    let body = fs.readFileSync(f);
    if (p.endsWith('/sw.js') && bumpFile && fs.existsSync(bumpFile)) body = Buffer.concat([body, Buffer.from('\n// v' + fs.readFileSync(bumpFile, 'utf8'))]);
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  })
  .listen(Number(port), '127.0.0.1');
