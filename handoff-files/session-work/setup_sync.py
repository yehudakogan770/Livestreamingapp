W = '/home/user/Livestreamingapp/.claude/worktrees/agent-a8bbcedf6528e53f8/supabase/'
u = open(W + 'update-2-editor-collab.sql').read()
body = u[u.index('-- Is the person asking approved (and not blocked)?'):]
s = open(W + 'setup.sql').read()
marker = '\n-- ---- Lumora Edit team projects'
if marker in s:
    s = s[: s.index(marker)]
s = s.rstrip('\n') + '\n' + marker + ' (the same as update-2-editor-collab.sql) ----\n\n' + body
open(W + 'setup.sql', 'w').write(s)
print('ok')
