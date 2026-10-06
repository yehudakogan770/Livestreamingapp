import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const PUBLIC = resolve(__dirname, 'public');
/** Public files the installed app does not need offline. */
const NOT_OFFLINE = /^(screenshots|splash)\//;

function publicFiles(dir = PUBLIC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? publicFiles(full) : [relative(PUBLIC, full).split('\\').join('/')];
  });
}

/**
 * sw.js, the service worker (see sw-template.js): the list of the build's
 * files to keep on the device, and a version that changes whenever any of them
 * does (so the same source always builds the same sw.js).
 */
function serviceWorker(): Plugin {
  return {
    name: 'planner-service-worker',
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
        if (NOT_OFFLINE.test(name)) continue;
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

// Lumora Planner: a static web app (source in ./planner), built into the
// website at docs/planner and served by GitHub Pages with the rest of docs/.
// Build it with `npm run planner:build` and commit docs/planner.
export default defineConfig({
  root: 'planner',
  base: './',
  plugins: [react(), serviceWorker()],
  clearScreen: false,
  server: { port: 1430, strictPort: true },
  build: {
    outDir: '../docs/planner',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
});
