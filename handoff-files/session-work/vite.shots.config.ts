// Screenshots only: the worktree's node_modules is a link to the main checkout,
// so let the dev server read files from there too.
import base from '/home/user/Livestreamingapp/.claude/worktrees/agent-a22c0ed40f10ed52f/editor/vite.config.ts';

export default {
  ...base,
  server: { ...base.server, port: 5277, strictPort: true, fs: { allow: ['/home/user/Livestreamingapp'] } },
};
