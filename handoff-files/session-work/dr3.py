import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
def rep(p, old, new):
    s = open(p).read()
    assert old in s, (p, old)
    s = s.replace(old, new, 1)
    open(p, 'w').write(s)

p = 'app/src/views/ControlView.tsx'
rep(p, """  const cards = [
    ...new Set([cardFor(sc.program), bar ? ('pesukim' as const) : null, sc.preview !== sc.program ? cardFor(sc.preview) : null].filter((c) => c !== null)),
  ];""", """  const cards = [
    ...new Set(
      [
        cardFor(sc.program),
        bar ? ('pesukim' as const) : null,
        sc.preview !== sc.program ? cardFor(sc.preview) : null,
        drawingTarget(show, screen) ? ('drawing' as const) : null,
      ].filter((c) => c !== null),
    ),
  ];""")
rep(p, """    ) : card === 'visuals' ? (
      <VisualsCard key={card} show={show} act={act} screen={screen} />""", """    ) : card === 'visuals' ? (
      <VisualsCard key={card} show={show} act={act} screen={screen} />
    ) : card === 'drawing' ? (
      <DrawingCard key={card} show={show} act={act} screen={screen} client={client} />""")
s = open(p).read()
i = s.index('\nimport ')
s = s[:i] + "\nimport { DrawingCard, drawingTarget } from './DrawingCard';" + s[i:]
open(p, 'w').write(s)
