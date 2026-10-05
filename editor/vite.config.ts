import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Lumora Studio's screens live in ./editor/app; the program serves them from ./dist-edit.
export default defineConfig({
  root: 'editor/app',
  plugins: [react()],
  clearScreen: false,
  server: { port: 1421, strictPort: true },
  build: {
    outDir: '../../dist-edit',
    emptyOutDir: true,
    target: 'es2022',
    // The shipped program carries no readable source: minified, with no source maps.
    sourcemap: false,
  },
});
