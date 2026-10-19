import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
p='titler/src/core/htmlTemplate.ts'
s=open(p,encoding='utf8').read()
s=s.replace("/ /g","/\\u2028/g").replace("/ /g","/\\u2029/g")
open(p,'w',encoding='utf8').write(s)
