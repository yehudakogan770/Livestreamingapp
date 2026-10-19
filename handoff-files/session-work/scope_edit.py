import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

edit('titler/src/core/render.ts', [
("""function drawComp(ctx: Ctx, comp: Composition, t: number, base: Mat, f: Frame) {""", """const scopes = new WeakMap<TitleProject, ExprScope>();

/** Where expressions' links find other layers: by name, anywhere in the title (each layer's own composition first). */
export function exprScopeFor(p: TitleProject): ExprScope {
  let s = scopes.get(p);
  if (!s) {
    const byName = new Map<string, Layer>();
    const walk = (ls: Layer[]) => {
      for (const l of ls) {
        if (!byName.has(l.name)) byName.set(l.name, l);
        if (l.type === 'group') walk(l.children);
      }
    };
    const main = p.compositions.find((c) => c.id === p.main);
    if (main) walk(main.layers);
    for (const c of p.compositions) walk(c.layers);
    s = {
      link(name, path, t) {
        const l = byName.get(name);
        let o: unknown = l;
        for (const part of path.split('.')) o = o && typeof o === 'object' ? (o as Record<string, unknown>)[part] : undefined;
        if (!o || typeof o !== 'object' || !('v' in o || 'k' in o)) return undefined;
        const prop = o as Prop<Value>;
        const first = isAnimated(prop) ? prop.k[0]?.v : prop.v;
        return valueAt(prop, t, (first ?? 0) as Value);
      },
    };
    scopes.set(p, s);
  }
  return s;
}

function drawComp(ctx: Ctx, comp: Composition, t: number, base: Mat, f: Frame) {"""),
("import { num, vec } from './easing';", "import { isAnimated, num, valueAt, vec } from './easing';\nimport { setExprScope, type ExprScope } from './expr';"),
("import type { Asset, BrandTokens, Composition, Effect, Layer, Paint, PathData, ShapeLayer, TextAnimator, TextLayer, TitleProject, Values, Vec2 } from './types';",
 "import type { Asset, BrandTokens, Composition, Effect, Layer, Paint, PathData, Prop, ShapeLayer, TextAnimator, TextLayer, TitleProject, Value, Values, Vec2 } from './types';"),
])
s = open('titler/src/core/render.ts').read()
i = s.index('export function renderFrame(')
j = s.index('\n}\n', i)
body = s[i:j+3]
print(body)
