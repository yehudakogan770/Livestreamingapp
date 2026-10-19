import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='designer.css'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''.tt-graph {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 20px;
}''','''.tt-graph {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  grid-template-rows: minmax(0, 1fr);
  gap: 20px;
  overflow: hidden;
}
.tt-graph-ease {
  min-height: 0;
  overflow: auto;
}''')
open(p,'w').write(s)
