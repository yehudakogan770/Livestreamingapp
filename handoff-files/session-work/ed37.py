import os, re
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/docs')
p='COMPETITORS-TITLER.md'; s=open(p).read()
lines=s.split('\n')
want={'3D layers with a camera':'✅ new','Components with per-copy overrides':'✅ new','Dockable panels':'✅ new','After Effects projects and MOGRT, Photoshop files':'◐ new'}
for i,l in enumerate(lines):
    for k,v in want.items():
        if l.startswith('| '+k+' '):
            cells=l.split('|')
            w=len(cells[-2])
            cells[-2]=(' '+v).center(w) if len(v)<w else ' '+v+' '
            # keep same width as the header cell (12 chars incl spaces)
            inner=v
            pad=w-len(inner)
            left=pad//2; right=pad-left
            cells[-2]=' '*left+inner+' '*right
            lines[i]='|'.join(cells)
s='\n'.join(lines)
exec(open('/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/ed36rest.py').read())
open(p,'w').write(s)
