import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
rep('titler/src/core/types.ts',"""  /** Font: the family it adds. */
  family?: string;""","""  /** Font: the family it adds, and which of its faces this file is (CSS weight "400" or "100 900", style "normal" / "italic"). */
  family?: string;
  weight?: string;
  style?: string;""")
rep('titler/src/core/browserEnv.ts',"await Promise.all(fonts.map((f) => loadFont(f.family!, f.src.startsWith('data:') ? f.src : urlFor(f.src))));",
"await Promise.all(fonts.map((f) => loadFont(f.family!, f.src.startsWith('data:') ? f.src : urlFor(f.src), { weight: f.weight, style: f.style })));")
rep('titler/src/core/browserEnv.ts',"""export function loadFont(family: string, url: string): Promise<void> {
  const key = `${family}|${url.slice(0, 200)}|${url.length}`;""","""export function loadFont(family: string, url: string, face: { weight?: string; style?: string } = {}): Promise<void> {
  const key = `${family}|${url.slice(0, 200)}|${url.length}`;
  const desc: FontFaceDescriptors = {};
  if (face.weight) desc.weight = face.weight;
  if (face.style) desc.style = face.style;""")
rep('titler/src/core/browserEnv.ts',"new FontFace(family, `url(${JSON.stringify(url)})`)","new FontFace(family, `url(${JSON.stringify(url)})`, desc)")
rep('titler/src/designer/exporting.ts',"kind: 'font', src: f.src, family: fam })","kind: 'font', src: f.src, family: fam, weight: f.weight, style: f.style })")
