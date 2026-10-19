W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'docs/ENGINE.md'
s=open(p).read()
a="""- Phase 2, vitest: `overlayWire`"""
assert s.count(a)==1
s=s.replace(a,"""- Phase 2, more: the multiview layout (classic, both screens, inputs only,
  wrapping, the JSON the web side reads) and its drawing on the GPU (each
  tile's picture, tally borders, the words plane on top); group opacity (a
  split fading as one picture); green screen and brightness in the shader
  (pixels checked); JPEG and PNG pictures from the app's frame store and an
  input going live with them; the picture delay.
- Phase 2, vitest: `overlayWire`""")
open(p,'w').write(s)
