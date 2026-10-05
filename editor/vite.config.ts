/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('..', import.meta.url));

// The AI engine (MediaPipe) and the person model are shared with Lumora: served
// from where they are while editing, and copied next to the screens when built.
// (Lumora Studio's own object model is in editor/app/public/models.)
const shared: Record<string, string> = {
  'mediapipe/vision_wasm_internal.js': 'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js',
  'mediapipe/vision_wasm_internal.wasm': 'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm',
  'models/selfie_segmenter.tflite': 'app/public/models/selfie_segmenter.tflite',
};

function visionFiles(): Plugin {
  const file = (from: string) => `${root}/${from}`;
  return {
    name: 'lumora-edit-vision-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]?.replace(/^\//, '') ?? '';
        const from = shared[path];
        if (!from || !existsSync(file(from))) return next();
        res.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(file(from)));
      });
    },
    generateBundle() {
      for (const [fileName, from] of Object.entries(shared)) {
        if (!existsSync(file(from))) throw new Error(`Missing ${from}: run npm install`);
        this.emitFile({ type: 'asset', fileName, source: readFileSync(file(from)) });
      }
    },
  };
}

// Lumora Edit's screens live in ./editor/app; the program serves them from ./dist-edit.
export default defineConfig({
  root: 'editor/app',
  plugins: [react(), visionFiles()],
  clearScreen: false,
  server: { port: 1421, strictPort: true },
  build: {
    outDir: '../../dist-edit',
    emptyOutDir: true,
    target: 'es2022',
    // The shipped program carries no readable source: minified, with no source maps.
    sourcemap: false,
  },
  // The motion tracker runs in a worker of its own.
  worker: { format: 'es' },
});
