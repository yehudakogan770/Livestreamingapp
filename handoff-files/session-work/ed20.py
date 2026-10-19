import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='designer.css'; s=open(p).read()
s+='''
/* Menus opened from the top bar keep their own item look. */
.tt-menu .tt-menu-pop .tt-menu-item {
  display: flex;
  height: auto;
  padding: 5px 10px 5px 4px;
}
.tt-menu .tt-menubtn {
  height: 28px;
}
'''
open(p,'w').write(s)
