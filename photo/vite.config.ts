import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const PUBLIC = resolve(__dirname, 'app/public');

function publicFiles(dir = PUBLIC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? publicFiles(full) : [relative(PUBLIC, full).split('\\').join('/')];
  });
}

/**
 * sw.js, the service worker (see sw-template.js): every file of the build kept
 * on the device, and a version that changes whenever any of them does (the
 * same source always builds the same sw.js).
 */
function serviceWorker(): Plugin {
  return {
    name: 'photo-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const hash = createHash('sha256');
      const files: string[] = [];
      for (const [name, out] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        files.push(name);
        hash.update(name);
        hash.update(out.type === 'chunk' ? out.code : typeof out.source === 'string' ? out.source : Buffer.from(out.source));
      }
      for (const name of publicFiles().sort()) {
        files.push(name);
        hash.update(name);
        hash.update(readFileSync(join(PUBLIC, name)));
      }
      const template = readFileSync(resolve(__dirname, 'sw-template.js'), 'utf8');
      const list = JSON.stringify(files.map((f) => `./${f}`));
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__VERSION__', hash.digest('hex').slice(0, 12)).replace('__FILES__', list),
      });
    },
  };
}

// Lumora Photo on the web: a static app (source in ./photo/app and
// ./photo/src), built into the website at docs/photo and served by GitHub
// Pages with the rest of docs/. Build it with `npm run photo:build` and commit
// docs/photo. The desktop app (photo/src-tauri) builds the same app into
// dist-photo with `npm run photo:ui:build`.
// (Mode "desktop": no service worker, built into dist-photo.)
export default defineConfig(({ mode }) => {
  const desktop = mode === 'desktop';
  return {
    root: 'photo/app',
    base: './',
    plugins: [react(), ...(desktop ? [] : [serviceWorker()])],
    clearScreen: false,
    server: { port: desktop ? 1435 : 1434, strictPort: true },
    define: { 'import.meta.env.VITE_PHOTO_DESKTOP': JSON.stringify(desktop ? '1' : '') },
    worker: { format: 'es' },
    build: {
      outDir: desktop ? '../../dist-photo' : '../../docs/photo',
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: !!process.env.PHOTO_SOURCEMAP,
      chunkSizeWarningLimit: 2000,
    },
  };
});
