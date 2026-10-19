import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/core/data.ts'
rep(p,"""/** The fields one row fills (a field named like a column takes it unless mapped otherwise). */
export function valuesFromRow(src: DataSource, t: Table, keys: string[]): Values {
  const row = t.rows[Math.min(Math.max(0, src.row), Math.max(0, t.rows.length - 1))];
  if (!row) return {};
  const out: Values = {};
  const col = (name: string) => t.headers.findIndex((h) => h.trim().toLowerCase() === name.trim().toLowerCase());
  for (const k of keys) {
    const name = src.map[k] ?? k;
    const i = col(name);
    if (i >= 0) out[k] = row[i] ?? '';
  }
  return out;
}""","""/** The most rows a list field takes from a column (a results table, standings, a schedule). */
export const MAX_LIST_ROWS = 200;

/**
 * The fields one row fills (a field named like a column takes it unless
 * mapped otherwise). A list field takes its whole column, one row a line,
 * from the chosen row on (tables: results, standings, schedules).
 */
export function valuesFromRow(src: DataSource, t: Table, keys: string[], vars: Variable[] = []): Values {
  const at = Math.min(Math.max(0, src.row), Math.max(0, t.rows.length - 1));
  const row = t.rows[at];
  if (!row) return {};
  const out: Values = {};
  const col = (name: string) => t.headers.findIndex((h) => h.trim().toLowerCase() === name.trim().toLowerCase());
  const lists = new Set(vars.filter((v) => v.type === 'list').map((v) => v.key));
  for (const k of keys) {
    const name = src.map[k] ?? k;
    const i = col(name);
    if (i < 0) continue;
    out[k] = lists.has(k)
      ? t.rows
          .slice(at, at + MAX_LIST_ROWS)
          .map((r) => (r[i] ?? '').replace(/\\s*\\n\\s*/g, ' '))
          .join('\\n')
      : (row[i] ?? '');
  }
  return out;
}""")
s=open(p).read()
import re
m=re.search(r"import type \{([^}]*)\} from './types';",s)
if 'Variable' not in m.group(1):
    s=s.replace(m.group(0),"import type {"+m.group(1).rstrip()+", Variable } from './types';",1)
open(p,'w').write(s)
rep('titler/src/designer/Panels.tsx',"store.set((s) => ({ values: { ...s.values, ...valuesFromRow(src, t, keys) } }));","store.set((s) => ({ values: { ...s.values, ...valuesFromRow(src, t, keys, store.get().project.variables) } }));")
rep('app/src/titler/titlerData.ts',"Object.assign(out, valuesFromRow({ ...src, row: rowOf(src, k) }, t, keys));","Object.assign(out, valuesFromRow({ ...src, row: rowOf(src, k) }, t, keys, p.variables));")

# player: read the title's own data sources
p='titler/src/player/player.ts'
rep(p,"""  private values: Values = {};""","""  private values: Values = {};
  /** What the title's own data sources hold now (under the values sent by the playout system). */
  private dataValues: Values = {};
  private dataTimers: ReturnType<typeof setInterval>[] = [];""")
rep(p,"""  /** Fonts and pictures loaded, first values set. */
  async load(values?: Values): Promise<void> {
    if (values) this.values = { ...this.values, ...values };
    await this.ready;
    this.draw();
  }""","""  /** Fonts and pictures loaded, first values set, the title's data sources read (and read again as they say). */
  async load(values?: Values): Promise<void> {
    if (values) this.values = { ...this.values, ...values };
    await this.ready;
    if (this.opts.data !== false) await this.readData();
    this.draw();
  }

  private async readData() {
    const keys = this.project.variables.map((v) => v.key);
    const one = async (src: DataSource) => {
      try {
        const t = await readSource(src);
        this.dataValues = { ...this.dataValues, ...valuesFromRow(src, t, keys, this.project.variables) };
        this.draw();
      } catch {
        /* keep what it had (offline, or the address is down) */
      }
    };
    const list = (this.project.data ?? []).filter((d) => d.url.trim());
    await Promise.all(list.map(one));
    for (const src of list) if (src.refresh > 0) this.dataTimers.push(setInterval(() => void one(src), Math.max(2, src.refresh) * 1000));
  }""")
rep(p,"""    for (const a of this.audio.values()) a.pause();""","""    for (const a of this.audio.values()) a.pause();
    for (const t of this.dataTimers) clearInterval(t);""")
rep(p,"""        renderFrame(ctx, this.project, { comp: c.id, time: r.t, clock: r.clock, values: this.values, env: this.env, width: dw, height: dh });""","""        renderFrame(ctx, this.project, { comp: c.id, time: r.t, clock: r.clock, values: { ...this.dataValues, ...this.values }, env: this.env, width: dw, height: dh });""")
rep(p,"""  /** Draw each frame with requestAnimationFrame (default on; tests draw by hand). */
  animate?: boolean;""","""  /** Draw each frame with requestAnimationFrame (default on; tests draw by hand). */
  animate?: boolean;
  /** Read the title's own data sources (CSV, Google Sheets, JSON) (default on). */
  data?: boolean;""")
rep(p,"import type { Composition, TitleProject, Values } from '../core/types';","import { readSource, valuesFromRow } from '../core/data';\nimport type { Composition, DataSource, TitleProject, Values } from '../core/types';")
