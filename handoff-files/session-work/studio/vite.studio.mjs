import { mergeConfig } from '/home/user/Livestreamingapp/node_modules/vite/dist/node/index.js';
import base from '/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/editor/vite.config.ts';

export default mergeConfig(base, {
  server: { port: 1471, strictPort: true, host: '127.0.0.1', fs: { strict: false }, watch: { ignored: ['**/node_modules/**', '**/target/**'] } },
});
