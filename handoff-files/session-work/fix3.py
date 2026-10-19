import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
rep('titler/src/core/types.ts',"""  weight?: string;
  style?: string;""","""  weight?: string;
  style?: string;
  /** The characters this file covers (CSS unicode-range), all when left out. */
  range?: string;""")
rep('titler/src/core/browserEnv.ts',"{ weight: f.weight, style: f.style })","{ weight: f.weight, style: f.style, range: f.range })")
rep('titler/src/core/browserEnv.ts',"face: { weight?: string; style?: string } = {}","face: { weight?: string; style?: string; range?: string } = {}")
rep('titler/src/core/browserEnv.ts',"  if (face.style) desc.style = face.style;","  if (face.style) desc.style = face.style;\n  if (face.range) desc.unicodeRange = face.range;")
rep('titler/src/designer/exporting.ts',"weight: f.weight, style: f.style })","weight: f.weight, style: f.style, ...(f.range ? { range: f.range } : {}) })")
rep('titler/src/designer/exporting.ts',"out.push({ src: data, weight: r.style.getPropertyValue('font-weight') || '400', style: r.style.getPropertyValue('font-style') || 'normal' });",
"out.push({\n          src: data,\n          weight: r.style.getPropertyValue('font-weight') || '400',\n          style: r.style.getPropertyValue('font-style') || 'normal',\n          range: r.style.getPropertyValue('unicode-range') || '',\n        });")
rep('titler/src/designer/exporting.ts',"Promise<{ src: string; weight: string; style: string }[]>","Promise<{ src: string; weight: string; style: string; range: string }[]>")
rep('titler/src/designer/exporting.ts',"const out: { src: string; weight: string; style: string }[] = [];","const out: { src: string; weight: string; style: string; range: string }[] = [];")
