import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
rep('titler/src/core/types.ts',"""  /** Layer space. */
  path: PathData;
  mode: 'add' | 'subtract' | 'intersect';""","""  /** Layer space. */
  path: PathData;
  /** The mask changing form over time (a wipe drawn as a moving mask); replaces `path`. */
  morph?: PathKey[] | null;
  mode: 'add' | 'subtract' | 'intersect';""")
rep('titler/src/core/render.ts',"    tracePath(m, mask.path);","    tracePath(m, mask.morph?.length ? (morphAt(mask.morph, s.t)[0] ?? mask.path) : mask.path);")
p='titler/src/core/lottie.ts'
rep(p,"""  const pt = m.pt as J | undefined;
  const k = pt?.k;
  const animated = Array.isArray(k) && isObj(k[0]) && 't' in (k[0] as J);
  if (animated && (k as unknown[]).length > 1) c.notes.add('Masks that change form keep their first form.');
  const path = bezier(animated ? arr((k[0] as J).s)[0] : k);""","""  const pt = m.pt as J | undefined;
  const k = pt?.k;
  const animated = Array.isArray(k) && isObj(k[0]) && 't' in (k[0] as J);
  const path = bezier(animated ? arr((k[0] as J).s)[0] : k);
  const morph = animated ? pathKeys({ ty: 'sh', ks: pt }, c, shift) : null;""")
rep(p,"function maskOf(m: J, c: Ctx): Mask | null {","function maskOf(m: J, c: Ctx, shift: number): Mask | null {")
rep(p,"""    path,
    mode: mode ?? 'add',""","""    path,
    ...(morph ? { morph } : {}),
    mode: mode ?? 'add',""")
rep(p,".map((m) => maskOf(m, c))",".map((m) => maskOf(m, c, shift))")
p='titler/src/core/lottieExport.ts'
rep(p,"""    pt: { a: 0, k: lpath(m.path) },""","""    pt: m.morph?.length ? pathKeysJson(x, m.morph) : { a: 0, k: lpath(m.path) },""")
rep(p,"""// ---- shapes ----""","""function pathKeysJson(x: X, ks: PathKey[]): J {
  return {
    a: 1,
    k: ks.map((k, n) => {
      const next = ks[n + 1];
      const key: J = { t: r3(k.t * x.fr), s: [lpath(k.v[0]!)] };
      if (next) {
        key.o = { x: [r3(k.o?.[0] ?? 0)], y: [r3(k.o?.[1] ?? 0)] };
        key.i = { x: [r3(next.i?.[0] ?? 1)], y: [r3(next.i?.[1] ?? 1)] };
        if (k.hold) key.h = 1;
      }
      return key;
    }),
  };
}

// ---- shapes ----""")
rep(p,"""    const ks = l.morph;
    items.push({
      ty: 'sh',
      ks: {
        a: 1,
        k: ks.map((k, n) => {
          const next = ks[n + 1];
          const key: J = { t: r3(k.t * x.fr), s: [lpath(k.v[0]!)] };
          if (next) {
            key.o = { x: [r3(k.o?.[0] ?? 0)], y: [r3(k.o?.[1] ?? 0)] };
            key.i = { x: [r3(next.i?.[0] ?? 1)], y: [r3(next.i?.[1] ?? 1)] };
            if (k.hold) key.h = 1;
          }
          return key;
        }),
      },
    });""","""    const ks = l.morph;
    items.push({ ty: 'sh', ks: pathKeysJson(x, ks) });""")
rep(p,"import type { BrandTokens, Composition, Keyframe, Layer, Paint, PathData, Prop,","import type { BrandTokens, Composition, Keyframe, Layer, Paint, PathData, PathKey, Prop,")
