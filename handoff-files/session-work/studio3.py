root='/home/user/Livestreamingapp/.claude/worktrees/agent-aa20d25c9832f0a41/editor/app/src/'
p=root+'ui/Timeline.tsx'
s=open(p).read()
a="""        {c.name}
      </span>
      {kind === 'audio' && h >= 30"""
assert s.count(a)==1
s=s.replace(a,"""        {c.name}
      </span>
      {c.source.kind === 'titler' && w > 24 && <TitlerClipMarks clip={c} fps={fps} zoom={zoom} />}
      {kind === 'audio' && h >= 30""")
i=s.index('\nimport ')
s=s[:i]+"\nimport { TitlerClipMarks } from '../titler/StudioTitler';"+s[i:]
open(p,'w').write(s)
