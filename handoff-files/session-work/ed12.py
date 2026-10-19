import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='designer.css'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''.tt-templates {
  display: grid;
  grid-template-columns: 1fr;''','''.tt-templates {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));''')
rep('''.tt-thumb {
  display: block;
  border-radius: 3px;
  border: 1px solid var(--tt-line);
}''','''.tt-thumb {
  display: block;
  border-radius: 3px;
  border: 1px solid var(--tt-line);
}
.tt-template .tt-thumb {
  width: 100% !important;
  height: auto !important;
}''')
rep('''.tt-title {
  color: var(--tt-dim);
  max-width: 260px;''','''.tt-title {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--tt-dim);
  max-width: 260px;''')
rep('''.tt-top {
  grid-area: top;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  background: var(--tt-bar);
  border-bottom: 1px solid var(--tt-line);
  min-width: 0;
}''','''.tt-top {
  grid-area: top;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  background: var(--tt-bar);
  border-bottom: 1px solid var(--tt-line);
  min-width: 0;
  overflow: hidden;
}
.tt-top > * {
  flex-shrink: 0;
}''')
rep('''@media (max-width: 1100px) {
  .tt-main {
    grid-template-columns: 200px minmax(0, 1fr) 280px;
  }
  .tt-check {
    display: none;
  }
}''','''/* Narrower windows: the menu shows its icons, the workspace its name. */
@media (max-width: 1480px) {
  .tt-workspace .tt-dim {
    display: none;
  }
}
@media (max-width: 1360px) {
  .tt-menu button {
    padding: 0 6px;
  }
  .tt-menu button .tt-menu-text {
    display: none;
  }
}''')
open(p,'w').write(s)

p='Designer.tsx'; s=open(p).read()
import re
for name in ['New','Open','Save','Import','Export','Render']:
    pat = re.compile(r'(<(?:Plus|FolderOpen|Save|FileInput|Download|Film) size=\{15\} />) '+name+r'\n')
    s, n = pat.subn(r'\1 <span className="tt-menu-text">'+name+'</span>\n', s)
    assert n==1, name
open(p,'w').write(s)
