import base from '/home/user/Livestreamingapp/.claude/worktrees/agent-ab8232dd66cb5660c/vite.config.ts';
// Screenshots only: the sign-in lock is off (as when the auth config is empty).
const noAuth = {
  name: 'no-auth',
  enforce: 'pre',
  load(id) {
    if (id.replace(/\?.*$/, '').endsWith('/app/src/auth/config.ts'))
      return "export const AUTH_URL = ''; export const AUTH_KEY = ''; export const authOn = () => false;";
  },
};
export default {
  ...base,
  plugins: [noAuth, ...(base.plugins || [])],
  root: '/home/user/Livestreamingapp/.claude/worktrees/agent-ab8232dd66cb5660c/app',
  server: { port: 5391, strictPort: true, fs: { allow: ['/home/user/Livestreamingapp'] } },
};
