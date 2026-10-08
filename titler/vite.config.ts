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
    name: 'titler-service-worker',
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

// Lumora Titler on the web: a static app (source in ./titler/app and
// ./titler/src), built into the website at docs/titler and served by GitHub
// Pages with the rest of docs/. Build it with `npm run titler:build` and commit
// docs/titler. The desktop app (titler/src-tauri) builds the same app into
// dist-titler with `npm run titler:ui:build`.
// (Mode "desktop": no service worker, built into dist-titler.)
export default defineConfig(({ mode }) => {
  const desktop = mode === 'desktop';
  return {
    root: 'titler/app',
    base: './',
    plugins: [react(), ...(desktop ? [] : [serviceWorker()])],
    clearScreen: false,
    server: { port: desktop ? 1433 : 1432, strictPort: true },
    define: { 'import.meta.env.VITE_TITLER_DESKTOP': JSON.stringify(desktop ? '1' : '') },
    build: {
      outDir: desktop ? '../../dist-titler' : '../../docs/titler',
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: false,
    },
  };
});
