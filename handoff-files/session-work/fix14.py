import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
add=open('/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/formats_add.ts').read()
p='titler/src/core/formats.ts'
open(p,'a').write(add)
rep('titler/src/core/types.ts',"""  /** A format of another composition (the main one) in another shape: picked on air by the picture's shape. */
  variantOf?: string;""","""  /** A format of another composition (the main one) in another shape: picked on air by the picture's shape. */
  variantOf?: string;
  /** A format follows changes to the main composition (keeping its own changes); false: it stands on its own. */
  follow?: boolean;""")
rep('titler/src/designer/store.ts',"""    const before = this.state.project;
    const next = fn(before);""","""    const before = this.state.project;
    // Formats follow the main composition's changes (core/formats.ts).
    const next = followMain(before, fn(before));""")
s=open('titler/src/designer/store.ts').read()
s=s.replace("\nimport ","\nimport { followMain } from '../core/formats';\nimport ",1)
open('titler/src/designer/store.ts','w').write(s)
