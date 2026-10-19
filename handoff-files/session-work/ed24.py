import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/core')
p='lottieExport.ts'; s=open(p).read()
a="  if (l.transform.rotationX || l.transform.rotationY || l.transform.z) base.ddd = 1;\n"
assert a in s
s=s.replace(a,a+"""  if (l.extrude && l.extrude.depth > 0) x.notes.add('Extruded layers are drawn flat (Lottie has no extrusion).');
  if (l.type === 'null' && l.camera) x.notes.add('The camera is left out: 3D layers are seen straight on.');
""")
open(p,'w').write(s)
