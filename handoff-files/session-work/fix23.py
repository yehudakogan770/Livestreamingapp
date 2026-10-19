import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/core/types.ts'
rep(p,"export type VariableType = 'text' | 'number' | 'color' | 'image' | 'list';","export type VariableType = 'text' | 'number' | 'color' | 'image' | 'list' | 'timer';")
rep(p,"""  /** List: what goes between the items when shown on one line (a ticker); one item a line when left out. */
  separator?: string;""","""  /** List: what goes between the items when shown on one line (a ticker); one item a line when left out. */
  separator?: string;
  /** Timer (game clock, countdown, stopwatch; see core/timer.ts): which way it runs, where it stops, how it shows, and whether it starts when the graphic is taken. */
  timer?: { dir: 'down' | 'up'; stop?: number; format?: 'm:ss' | 'mm:ss' | 'h:mm:ss' | 'ss' | 'm:ss.t' | 'ss.t'; auto?: boolean };""")
p='titler/src/core/validate.ts'
rep(p,"const VAR_TYPES = new Set(['text', 'number', 'color', 'image', 'list']);","const VAR_TYPES = new Set(['text', 'number', 'color', 'image', 'list', 'timer']);")
p='titler/src/core/binding.ts'
rep(p,"""/** A variable's value as shown (numbers formatted, lists one item a line). */
export function formatValue(v: Variable | undefined, raw: string): string {
  if (!v) return raw;""","""/** The clock of the frame being drawn (seconds since the graphic was taken), for timers that start when taken. */
let renderClock: number | null = null;
export function setRenderClock(clock: number | null): number | null {
  const before = renderClock;
  renderClock = clock;
  return before;
}

/** A variable's value as shown (numbers formatted, lists one item a line, timers running). */
export function formatValue(v: Variable | undefined, raw: string): string {
  if (!v) return raw;
  if (v.type === 'timer') return timerText(v, raw, Date.now(), renderClock);""")
rep(p,"import type { BrandTokens, TitleProject, Values, Variable } from './types';","import { timerText } from './timer';\nimport type { BrandTokens, TitleProject, Values, Variable } from './types';")
p='titler/src/core/render.ts'
rep(p,"""  const before = setExprScope(exprScopeFor(project));
  try {
    drawComp(ctx, comp, opts.time, mul(outer, base), f);
  } finally {
    setExprScope(before);""","""  const before = setExprScope(exprScopeFor(project));
  const clockBefore = setRenderClock(f.clock);
  try {
    drawComp(ctx, comp, opts.time, mul(outer, base), f);
  } finally {
    setExprScope(before);
    setRenderClock(clockBefore);""")
rep(p,"import { fill, resolveColor, resolveFont, tokensFor, valuesFor } from './binding';","import { fill, resolveColor, resolveFont, setRenderClock, tokensFor, valuesFor } from './binding';")
p='app/src/titler/titlerSource.ts'
rep(p,"  return p.variables.some((v) => v.bind === 'score:clock' || v.bind === 'countdown' || v.bind === 'clock:time') || movesByItself(p);","  return p.variables.some((v) => v.bind === 'score:clock' || v.bind === 'countdown' || v.bind === 'clock:time' || v.type === 'timer') || movesByItself(p);")
