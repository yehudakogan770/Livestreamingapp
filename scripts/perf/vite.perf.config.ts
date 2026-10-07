// A production build of Lumora's window for profiling in a browser (see
// docs/PERFORMANCE.md): the sign-in lock off, the browser demo engine
// reachable as window.__demo, and the test cameras served from PERF_MEDIA.
// Unless MIN=1 it is also unminified with React's profiling build, so
// components keep their names and render times can be counted.
//   OUT=<dir> npx vite build -c scripts/perf/vite.perf.config.ts
//   npx vite preview -c scripts/perf/vite.perf.config.ts --outDir <dir> --port 1431
import { createReadStream, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import base from '../../vite.config';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const MEDIA = process.env.PERF_MEDIA || `${tmpdir()}/lumora-perf-media`;
const MIN = !!process.env.MIN;

const noAuth: Plugin = {
  name: 'perf-no-auth',
  enforce: 'pre',
  load(id) {
    if (id.replace(/\?.*$/, '').endsWith('/app/src/auth/config.ts'))
      return "export const AUTH_URL = ''; export const AUTH_KEY = ''; export const authOn = () => false;";
  },
};

const serveMedia = (server: ViteDevServer | PreviewServer) => {
  server.middlewares.use((req, res, next) => {
    const path = (req.url ?? '').split('?')[0]!;
    if (!path.startsWith('/perf-media/') || path.includes('..')) return next();
    const f = MEDIA + path.slice('/perf-media'.length);
    if (!existsSync(f)) return next();
    const size = statSync(f).size;
    res.setHeader('Content-Type', f.endsWith('.webm') ? 'video/webm' : f.endsWith('.png') ? 'image/png' : 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    const range = req.headers.range;
    if (range) {
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = Number(s);
      const end = e ? Number(e) : size - 1;
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', end - start + 1);
      createReadStream(f, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', size);
      createReadStream(f).pipe(res);
    }
  });
};
const media: Plugin = { name: 'perf-media', configureServer: serveMedia, configurePreviewServer: serveMedia };

const hooks: Plugin = {
  name: 'perf-hooks',
  enforce: 'pre',
  transform(code, id) {
    const p = id.replace(/\?.*$/, '');
    // The demo engine, to build the show from the measuring script.
    if (p.endsWith('/app/src/engine/client.ts'))
      return `${code}
if (typeof window !== 'undefined') {
  const getShow = DemoClient.prototype.getShow;
  DemoClient.prototype.getShow = function () { window.__demo = this; return getShow.call(this); };
}
`;
    if (p.endsWith('/app/src/engine/text.ts')) return `${code}\nif (typeof window !== 'undefined') window.__text = { TEXT_TEMPLATES };\n`;
    // React's own count of renders and their time.
    if (p.endsWith('/app/src/main.tsx') && !MIN)
      return code
        .replace("import { StrictMode } from 'react';", "import { StrictMode, Profiler } from 'react';")
        .replace(
          '<App />',
          '<Profiler id="app" onRender={(_i, _p, ms) => { const s = ((window as any).__prof ??= { commits: 0, ms: 0 }); s.commits++; s.ms += ms; }}><App /></Profiler>',
        );
  },
};

export default {
  ...base,
  root: `${REPO}app`,
  plugins: [noAuth, media, hooks, ...(base.plugins ?? [])],
  resolve: MIN ? {} : { alias: [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }] },
  build: { ...base.build, outDir: process.env.OUT ?? `${tmpdir()}/lumora-perf-build`, emptyOutDir: true, minify: MIN },
  preview: { port: 1431, strictPort: true },
};
