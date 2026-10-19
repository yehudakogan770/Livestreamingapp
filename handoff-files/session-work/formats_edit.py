import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

edit('titler/src/core/validate.ts', [
("""  if (isObj(p) && Array.isArray(p.k)) {
    const k = p.k.filter((x): x is Json => isObj(x) && typeof x.t === 'number' && Number.isFinite(x.t) && okValue(x.v));
    if (k.length !== p.k.length) notes.push(`${where}: removed keyframes that could not be read.`);
    k.sort((a, b) => (a.t as number) - (b.t as number));
    if (!k.length) return { v: fallback };
    return { k: k as never };
  }
  if (isObj(p) && okValue(p.v)) return { v: p.v as Value };""", """  // An expression is kept (it is only ever worked out by core/expr.ts, never run).
  const x = isObj(p) && typeof p.x === 'string' && p.x.trim() ? { x: p.x.slice(0, 2000) } : {};
  if (isObj(p) && Array.isArray(p.k)) {
    const k = p.k.filter((x): x is Json => isObj(x) && typeof x.t === 'number' && Number.isFinite(x.t) && okValue(x.v));
    if (k.length !== p.k.length) notes.push(`${where}: removed keyframes that could not be read.`);
    k.sort((a, b) => (a.t as number) - (b.t as number));
    if (!k.length) return { v: fallback, ...x };
    return { k: k as never, ...x };
  }
  if (isObj(p) && okValue(p.v)) return { v: p.v as Value, ...x };"""),
("""    guides: isObj(c.guides) ? c.guides : undefined,""", """    guides: isObj(c.guides) ? c.guides : undefined,
    ...(typeof c.variantOf === 'string' && c.variantOf ? { variantOf: c.variantOf } : {}),"""),
])

edit('titler/src/core/types.ts', [
("""  /** A label color in the designer's layer list. */
  label?: string;
}""", """  /** A label color in the designer's layer list. */
  label?: string;
  /** How it is re-placed in another format of the title (16:9 → 9:16…); nearest edge when left out. */
  constraints?: Constraints;
}

/** Pinned to an edge or the middle, scaled with the frame, or stretched with it. */
export interface Constraints {
  h?: 'left' | 'right' | 'center' | 'scale' | 'stretch';
  v?: 'top' | 'bottom' | 'center' | 'scale' | 'stretch';
}"""),
("""  /** Front first. */
  layers: Layer[];
  guides?: { x: number[]; y: number[] };
}""", """  /** Front first. */
  layers: Layer[];
  guides?: { x: number[]; y: number[] };
  /** A format of another composition (the main one) in another shape: picked on air by the picture's shape. */
  variantOf?: string;
}"""),
])

edit('titler/src/core/render.ts', [
("""export function renderFrame(ctx: Ctx, project: TitleProject, opts: RenderOptions): void {
  const comp = project.compositions.find((c) => c.id === (opts.comp ?? project.main)) ?? project.compositions[0];""", """export function renderFrame(ctx: Ctx, project: TitleProject, opts: RenderOptions): void {
  // No composition asked for: the format whose shape is closest to the picture (16:9, 9:16…).
  const comp =
    (opts.comp ? project.compositions.find((c) => c.id === opts.comp) : opts.width && opts.height ? pickFormat(project, opts.width, opts.height) : undefined) ??
    project.compositions.find((c) => c.id === project.main) ??
    project.compositions[0];"""),
("import { setExprScope, type ExprScope } from './expr';", "import { setExprScope, type ExprScope } from './expr';\nimport { pickFormat } from './formats';"),
])
print('ok')
