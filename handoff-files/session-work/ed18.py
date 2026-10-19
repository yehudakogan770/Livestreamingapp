import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='Inspector.tsx'; s=open(p).read()
a=s.index('      <Section title="Wipe and blur" open={!!l.reveal || !!l.blur}>')
b=s.index('      <StyleSection store={store} l={l} compId={c.id} />\n')
end=b+len('      <StyleSection store={store} l={l} compId={c.id} />\n')
block=s[a:end]
# indent block by 2 and wrap
inner='\n'.join(('  '+line if line else line) for line in block.rstrip('\n').split('\n'))
s=s[:a]+"      {l.type !== 'null' && (\n        <>\n"+inner+"\n        </>\n      )}\n"+s[end:]
open(p,'w').write(s)
