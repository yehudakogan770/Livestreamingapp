import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='workspace.ts'; s=open(p).read()
a='''        const tabs = (Array.isArray(o?.tabs) ? o!.tabs : []).filter((t): t is PanelId => PANELS.includes(t as PanelId) && !seen.has(t as PanelId));
        tabs.forEach((t) => seen.add(t));'''
b='''        const tabs = (Array.isArray(o?.tabs) ? o!.tabs : []).filter((t): t is PanelId => {
          if (!PANELS.includes(t as PanelId) || seen.has(t as PanelId)) return false;
          seen.add(t as PanelId);
          return true;
        });'''
assert a in s
s=s.replace(a,b)
open(p,'w').write(s)
p='Designer.test.tsx'; s=open(p).read()
s=s.replace("fireEvent.click(screen.getByRole('button', { name: 'Library' }));","fireEvent.click(screen.getByRole('tab', { name: 'Library' }));")
s=s.replace("fireEvent.click(screen.getByRole('button', { name: 'Fields' }));","fireEvent.click(screen.getByRole('tab', { name: 'Fields' }));")
open(p,'w').write(s)
