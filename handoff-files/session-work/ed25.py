import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='Viewport.tsx'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''    if (tool === 'note') {
      const note''','''    if (tool === 'note') {
      // The note's card takes the typing (the canvas must not take the focus back).
      e.preventDefault();
      const note''')
rep('''      if (hit) {
        store.set({ editingNote: hit.id });
        return;
      }''','''      if (hit) {
        e.preventDefault();
        store.set({ editingNote: hit.id });
        return;
      }''')
open(p,'w').write(s)
