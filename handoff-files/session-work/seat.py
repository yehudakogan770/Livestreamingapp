p='/home/user/Livestreamingapp/.claude/worktrees/agent-aa20d25c9832f0a41/app/src/seats/SeatPanels.tsx'
s=open(p).read()
a="""  const texts = sources.filter((s) => s.kind.type === 'text');
"""
assert s.count(a)==1
s=s.replace(a,"""  const texts = sources.filter((s) => s.kind.type === 'text');
  const titlers = sources.filter((s) => s.kind.type === 'titler');
""")
a="""      {countdowns.length > 0 && (
        <Section title="Countdowns">"""
assert s.count(a)==1
s=s.replace(a,"""      {titlers.length > 0 && (
        <Section title="Titler graphics">
          <SeatGate group="titles" className="seat-list">
            {titlers.map((s) => (
              <TitlerFields key={s.id} source={s} show={show} act={act} />
            ))}
          </SeatGate>
        </Section>
      )}
      {countdowns.length > 0 && (
        <Section title="Countdowns">""")
i=s.index('\nimport ')
s=s[:i]+"\nimport { TitlerFields } from '../titler/TitlerFields';"+s[i:]
open(p,'w').write(s)
