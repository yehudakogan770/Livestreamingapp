import base from '/home/user/Livestreamingapp/.claude/worktrees/agent-a093bb10d97d984fc/editor/vite.config.ts';
// Screenshots only: lets the dev server read the symlinked node_modules (fonts).
export default { ...base, server: { ...base.server, port: 5277, fs: { allow: ['/home/user/Livestreamingapp'] } } };
