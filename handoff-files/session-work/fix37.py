import os, subprocess
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
lines = open('docs/API.md').read().split('\n')
a = lines.index('<<<<<<< HEAD'); m = lines.index('=======', a); b = next(i for i in range(m, len(lines)) if lines[i].startswith('>>>>>>> '))
theirs = lines[m+1:b]
out = []
for l in theirs:
    if l.startswith('| `ptz`'):
        out.append("| `titler` | `input` or `name`, then `field` and `value` (or `set.<field>=…`, several at once), or `do` (`next`, `previous`, `start`, `stop`, `toggle`, `reset`) with `field` | A Lumora Titler graphic: its fields, its data rows, its timers |")
    out.append(l)
lines = lines[:a] + out + lines[b+1:]
open('docs/API.md','w').write('\n'.join(lines))
r = subprocess.run(['node','/opt/node22/lib/node_modules/prettier/bin/prettier.cjs','--write','docs/API.md'],capture_output=True,text=True); print(r.stdout, r.stderr)
