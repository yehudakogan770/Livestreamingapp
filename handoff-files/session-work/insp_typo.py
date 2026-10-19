import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
p='titler/src/designer/Inspector.tsx'
s=open(p).read()
def rep(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b)
rep("""        <Toggle value={!!st.caps} onChange={(caps) => style('Capitals', { caps })} label="Capitals" />""","""        <Toggle value={!!st.caps} onChange={(caps) => style('Capitals', { caps })} label="Capitals" />
        <Toggle value={!!st.smallCaps} onChange={(smallCaps) => style('Small capitals', { smallCaps })} label="Small caps" />""")
rep("""          options={[
            ['left', 'Left'],
            ['center', 'Center'],
            ['right', 'Right'],
          ]}
          onChange={(align) => style('Align', { align })}""","""          options={[
            ['left', 'Left'],
            ['center', 'Center'],
            ['right', 'Right'],
            ['justify', 'Justify'],
          ]}
          onChange={(align) => style('Align', { align })}""")
rep("""      <Row label="Box">
        <NumberField value={l.box[0]} min={0} label="Box width\"""","""      <Row label="Figures" hint="Tabular figures keep every digit the same width, so scores and clocks don't shift as they change.">
        <Select
          label="Figures"
          value={st.figures ?? 'proportional'}
          options={[
            ['proportional', 'Proportional'],
            ['tabular', 'Tabular (scores, clocks)'],
          ]}
          onChange={(figures) => style('Figures', { figures: figures === 'proportional' ? undefined : figures })}
        />
        <Select
          label="Kerning"
          value={st.kerning ?? 'auto'}
          options={[
            ['auto', 'Kerning: font'],
            ['none', 'Kerning: none'],
          ]}
          onChange={(kerning) => style('Kerning', { kerning: kerning === 'auto' ? undefined : kerning })}
        />
      </Row>
      <Row label="Box">
        <NumberField value={l.box[0]} min={0} label="Box width\"""")
rep("""<div className="tt-dim tt-small">Styling inside the words: [b]bold[/b], [i]italic[/i], [c=$accent]color[/c], [s=80]size[/s].</div>""","""<div className="tt-dim tt-small">
        Styling inside the words: [b]bold[/b], [i]italic[/i], [c=$accent]color[/c], [s=80]size[/s], [v=30]baseline shift[/v].
      </div>""")
open(p,'w').write(s)
print('ok')
