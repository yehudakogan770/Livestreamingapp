import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/core')
p='validate.ts'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''      opacity: cleanProp(tr.opacity, 100, notes, where),
    },
  } as Json;''','''      opacity: cleanProp(tr.opacity, 100, notes, where),
      // 3D layers: turned across and up and down, and depth (kept only when set).
      ...(tr.rotationX !== undefined ? { rotationX: cleanProp(tr.rotationX, 0, notes, where) } : {}),
      ...(tr.rotationY !== undefined ? { rotationY: cleanProp(tr.rotationY, 0, notes, where) } : {}),
      ...(tr.z !== undefined ? { z: cleanProp(tr.z, 0, notes, where) } : {}),
    },
  } as Json;
  if (l.extrude !== undefined) {
    const e = isObj(l.extrude) ? l.extrude : null;
    const depth = e ? Math.min(2000, Math.max(0, finite(e.depth, 0))) : 0;
    if (e && depth > 0) out.extrude = { ...e, depth, ...(typeof e.color === 'string' ? { color: e.color } : {}) };
    else delete out.extrude;
  }''')
rep('''    guides: isObj(c.guides) ? c.guides : undefined,
    ...(typeof c.variantOf === 'string' && c.variantOf ? { variantOf: c.variantOf } : {}),''','''    guides: isObj(c.guides) ? c.guides : undefined,
    ...(typeof c.variantOf === 'string' && c.variantOf ? { variantOf: c.variantOf } : {}),
    ...(typeof c.follow === 'boolean' ? { follow: c.follow } : {}),
    ...(c.perspective !== undefined ? { perspective: Math.round(Math.min(100000, Math.max(100, finite(c.perspective, 2000)))) } : {}),''')
open(p,'w').write(s)
