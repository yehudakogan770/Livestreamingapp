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
  },
  test: {
    root: '.',
    environment: 'jsdom',
    include: ['app/src/**/*.test.{ts,tsx}'],
    setupFiles: ['app/src/test-setup.ts'],
  },
});
