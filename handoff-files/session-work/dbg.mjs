import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
const root = '/home/user/Livestreamingapp/.claude/worktrees/agent-a59d26fde936f61dd/docs/photo';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = join(root, url.endsWith('/') ? `${url}index.html` : url);
  if (!existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => console.log('console:', m.type(), m.text()));
page.on('pageerror', (e) => console.log('pageerror', e));
await page.goto(`http://127.0.0.1:${server.address().port}/?debug`);
await page.waitForFunction(() => window.__photo);
const out = await page.evaluate(async () => {
  const P = window.__photo;
  const gl = document.querySelector('.lp-canvas-wrap canvas').getContext('webgl2');
  window.__errs = [];
  const orig = gl.drawArrays.bind(gl);
  gl.drawArrays = (...a) => {
    orig(...a);
    const e = gl.getError();
    if (e) {
      const prog = gl.getParameter(gl.CURRENT_PROGRAM);
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      const samplers = [];
      for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(prog, i); if ([gl.SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D, gl.INT_SAMPLER_2D, gl.SAMPLER_3D].includes(u.type)) samplers.push(u.name + ':' + u.type + '@' + gl.getUniform(prog, gl.getUniformLocation(prog, u.name))); }
      const fs = gl.getAttachedShaders(prog).map((s) => gl.getShaderSource(s)).find((x) => x.includes('out vec4') || x.includes('fragColor'));
      const units = [];
      for (let u = 0; u < 8; u++) { gl.activeTexture(gl.TEXTURE0 + u); units.push(gl.getParameter(gl.TEXTURE_BINDING_2D)); }
      window.__errs.push({ e, samplers, units, stack: new Error().stack.split('\n').slice(1,8).join(' | ') });
    }
  };
  await P.run('key.newDocDefault');
  await new Promise((r) => setTimeout(r, 500));
  const s = P.current();
  const r = { x: 10, y: 10, w: 4, h: 2 };
  const a = Array.from(P.flatten(s.doc, r)).slice(0, 8);
  const b = Array.from(P.compositeRect(s.doc, r)).slice(0, 8);
  const c = s.compositor;
  const th = c?.thumbnail(8);
  const dd = c.dummies; const comp = c.comp; const errs = window.__errs.slice(0,2).map((x) => ({ samplers: x.samplers, stack: x.stack, units: x.units.map((t) => t === dd?.u ? 'DUMMY_U' : t === dd?.f ? 'dummyF' : t === comp?.tex ? 'COMP' : t ? 'tex' : 'null') })); return { errs, a, b, th: th ? Array.from(th.data).slice(0, 16) : null, caps: c?.gpu.caps, layers: s.doc.layers.map((l) => [l.kind, l.raster?.tiles.size]) };
});
console.log(JSON.stringify(out));
await page.screenshot({ path: '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/dbg.png' });
await browser.close();
server.close();
