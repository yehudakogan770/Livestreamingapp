import subprocess, os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
files = [l.strip() for l in open('/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/changed.txt') if l.strip() and not l.startswith('docs/titler/')]
r = subprocess.run(['node', '/opt/node22/lib/node_modules/prettier/bin/prettier.cjs', '--write', *files], capture_output=True, text=True)
print('\n'.join(l for l in r.stdout.splitlines() if 'unchanged' not in l))
print(r.stderr[-2000:])
