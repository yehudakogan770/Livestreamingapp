// Dev-only harness: the real Planner UI over a fake data layer. Not shipped.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = '/home/user/Livestreamingapp/.claude/worktrees/agent-aa5adcd4cc3070437/planner';

export default defineConfig({
  root,
  base: './',
  plugins: [
    react(),
    {
      name: 'fake-data',
      enforce: 'pre',
      resolveId(src, importer) {
        if (!importer || !importer.startsWith(root + '/src')) return null;
        if (src === './api') return path.join(here, '../mock/api.ts');
        if (src === './session') return path.join(here, '../mock/session.ts');
        return null;
      },
    },
  ],
  server: { port: 1499, strictPort: true, fs: { allow: ['/'] } },
  clearScreen: false,
});
