import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Lumora Planner: a static web app (source in ./planner), built into the
// website at docs/planner and served by GitHub Pages with the rest of docs/.
// Build it with `npm run planner:build` and commit docs/planner.
export default defineConfig({
  root: 'planner',
  base: './',
  plugins: [react()],
  clearScreen: false,
  server: { port: 1430, strictPort: true },
  build: {
    outDir: '../docs/planner',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
});
