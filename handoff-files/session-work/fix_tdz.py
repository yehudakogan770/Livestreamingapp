import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
p='titler/src/core/render.ts'
s=open(p).read()
block = """  // Tabular figures, no kerning and justified lines are placed letter by letter.
  const perGlyph = st.figures === 'tabular' || st.kerning === 'none' || st.align === 'justify';
  const up = (g: Glyph) => (g.style.shift ? (g.style.shift / 100) * lay.size : 0);

"""
assert block in s
s = s.replace(block, '')
s = s.replace("""  const animated = !!l.animators?.length;
""", """  const animated = !!l.animators?.length;
""" + block.rstrip('\n') + "\n", 1)
open(p,'w').write(s)
print('ok')
