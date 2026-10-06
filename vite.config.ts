import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The UI lives in ./app; Tauri serves it from ./dist in release builds.
export default defineConfig({
  root: 'app',
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    // The shipped app carries no readable source: minified, with no source maps.
    sourcemap: false,
    // One stylesheet for every window, loaded at the start, as before the
    // windows were split into parts loaded when needed: every style is there
    // from the first frame, in the same order.
    cssCodeSplit: false,
  },
  test: {
    root: '.',
    environment: 'jsdom',
    include: [
      'app/src/**/*.test.{ts,tsx}',
      'src-tauri/remote/**/*.test.ts',
      'editor/app/src/**/*.test.{ts,tsx}',
      'planner/src/**/*.test.{ts,tsx}',
      'streamdeck/src/**/*.test.ts',
    ],
    setupFiles: ['app/src/test-setup.ts'],
    testTimeout: 20000,
  },
});
