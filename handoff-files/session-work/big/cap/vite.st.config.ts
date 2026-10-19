import base from '/home/user/Livestreamingapp/.claude/worktrees/agent-ace45bb64fa23b74f/editor/vite.config.ts';
import { createReadStream, existsSync, statSync } from 'node:fs';
const W = '/home/user/Livestreamingapp/.claude/worktrees/agent-ace45bb64fa23b74f';
const noAuth = {
  name: 'no-auth',
  enforce: 'pre',
  load(id) {
    if (id.replace(/\?.*$/, '').endsWith('/app/src/auth/config.ts'))
      return "export const AUTH_URL = ''; export const AUTH_KEY = ''; export const authOn = () => false;";
  },
};
const demo = {
  name: 'demo-media',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '').split('?')[0];
      if (!path.startsWith('/demo/')) return next();
      const f = '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/big/demo' + path.slice(5);
      if (!existsSync(f)) return next();
      const size = statSync(f).size;
      const range = req.headers.range;
      res.setHeader('Content-Type', 'video/webm');
      res.setHeader('Accept-Ranges', 'bytes');
      if (range) {
        const [s, e] = range.replace('bytes=', '').split('-');
        const start = Number(s), end = e ? Number(e) : size - 1;
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
export default {
  ...base,
  root: W + '/editor/app',
  plugins: [noAuth, demo, ...(base.plugins || [])],
  server: { port: 5393, strictPort: true, fs: { allow: ['/home/user/Livestreamingapp'] } },
};
