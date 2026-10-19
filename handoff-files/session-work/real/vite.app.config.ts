import base from '/home/user/Livestreamingapp/.claude/worktrees/agent-a28f31ba65a5e6c6f/vite.config.ts';
import { createReadStream, existsSync, statSync } from 'node:fs';
const W = '/home/user/Livestreamingapp/.claude/worktrees/agent-a28f31ba65a5e6c6f';
const S = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad';
const noAuth = {
  name: 'no-auth',
  enforce: 'pre',
  load(id) {
    if (id.replace(/\?.*$/, '').endsWith('/app/src/auth/config.ts'))
      return "export const AUTH_URL = ''; export const AUTH_KEY = ''; export const authOn = () => false;";
  },
};
const TYPES = { mp4: 'video/mp4', webm: 'video/webm', jpg: 'image/jpeg', png: 'image/png', wav: 'audio/wav' };
/** Serves /real/<dir>/<file> from the scratchpad (footage for the screenshots). */
const media = {
  name: 'real-media',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '').split('?')[0];
      if (!path.startsWith('/real/') || path.includes('..')) return next();
      const f = S + path.replace(/^\/real\//, '/');
      if (!existsSync(f)) return next();
      const size = statSync(f).size;
      const range = req.headers.range;
      res.setHeader('Content-Type', TYPES[f.split('.').pop()] ?? 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      if (range) {
        const [s, e] = range.replace('bytes=', '').split('-');
        const start = Number(s),
          end = e ? Number(e) : size - 1;
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', end - start + 1);
        createReadStream(f, { start, end }).pipe(res);
      } else {
        res.setHeader('Content-Length', size);
        createReadStream(f).pipe(res);
      }
    });
  },
};
/** For the screenshots only (?shots): the event looks saved, and the demo engine can be reached. */
const shots = {
  name: 'shots',
  transform(code, id) {
    if (!id.replace(/\?.*$/, '').endsWith('/app/src/engine/client.ts')) return;
    return (
      code +
      `
if (typeof window !== 'undefined' && /[?&]shots/.test(location.search)) {
  const FILE = 'C:/Users/Production/Documents/Lumora/Northwind Summit 2026.lumora';
  const P = DemoClient.prototype;
  P.eventFiles = function () { return Promise.resolve({ current: FILE, recent: [FILE] }); };
  P.watchEventFiles = function (cb) { cb({ current: FILE, recent: [FILE] }); return () => {}; };
  const g = P.getShow;
  P.getShow = function () { window.__demo = this; return g.call(this); };
}
`
    );
  },
};
export default {
  ...base,
  root: W + '/app',
  plugins: [noAuth, media, shots, ...(base.plugins || [])],
  server: { port: 1420, strictPort: true, fs: { allow: ['/home/user/Livestreamingapp'] } },
};
