import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/player/player.ts'
rep(p,"""  getValues(): Values {""","""  /** A timer field's buttons (the first timer when no key is given): start, stop, toggle, reset, add seconds. */
  timer(cmd: 'start' | 'stop' | 'toggle' | 'reset' | 'add', key?: string, amount = 0): boolean {
    const v = this.project.variables.find((x) => x.type === 'timer' && (!key || x.key === key));
    if (!v) return false;
    const now = this.opts.now ? Date.now() : Date.now();
    this.update({ [v.key]: timerCommand(v, this.values[v.key] ?? v.value, cmd, now, amount) });
    return true;
  }

  getValues(): Values {""")
rep(p,"import { readProject } from '../core/validate';","import { readProject } from '../core/validate';\nimport { timerCommand } from '../core/timer';")
p='titler/src/player/runtime.ts'
rep(p,"""  w.lumoraTitle = player;""","""  // Timer fields: timer('start' | 'stop' | 'toggle' | 'reset' | 'add', field?, seconds?)
  w.timer = (cmd: 'start' | 'stop' | 'toggle' | 'reset' | 'add', key?: string, amount?: number) => player.timer(cmd, key, Number(amount) || 0);
  w.lumoraTitle = player;""")
rep(p,"""    else if (m.lumoraTitle === 'clear') player.clear();""","""    else if (m.lumoraTitle === 'clear') player.clear();
    else if (m.lumoraTitle === 'timer') {
      const d = (m.data ?? {}) as { cmd?: string; field?: string; seconds?: number };
      player.timer((d.cmd ?? 'toggle') as 'toggle', d.field, Number(d.seconds) || 0);
    }""")
rep(p,"""    async customAction(): Promise<Result> {
      return { statusCode: 404, statusMessage: 'This graphic has no custom actions' };
    }""","""    async customAction(params: { id?: string; payload?: unknown } = {}): Promise<Result> {
      const cmd = { timerStart: 'start', timerStop: 'stop', timerToggle: 'toggle', timerReset: 'reset', timerAdd: 'add' }[params.id ?? ''] as 'start' | undefined;
      const d = (params.payload ?? {}) as { field?: string; seconds?: number };
      if (!cmd || !this.player?.timer(cmd, d.field, Number(d.seconds) || 0)) return { statusCode: 404, statusMessage: 'This graphic has no such action' };
      return { statusCode: 200 };
    }""")
p='titler/src/core/htmlTemplate.ts'
rep(p,"""    stepCount: 1,
    schema: dataSchema(p),""","""    stepCount: 1,
    schema: dataSchema(p),
    ...(p.variables.some((v) => v.type === 'timer') ? { customActions: TIMER_ACTIONS } : {}),""")
rep(p,"""export function ografManifest(""","""const TIMER_PAYLOAD = {
  type: 'object',
  properties: { field: { type: 'string', title: 'Timer field (the first when left out)' }, seconds: { type: 'number', title: 'Seconds (for Add)' } },
};
const TIMER_ACTIONS = [
  { id: 'timerStart', name: 'Start timer', schema: TIMER_PAYLOAD },
  { id: 'timerStop', name: 'Stop timer', schema: TIMER_PAYLOAD },
  { id: 'timerToggle', name: 'Start or stop timer', schema: TIMER_PAYLOAD },
  { id: 'timerReset', name: 'Reset timer', schema: TIMER_PAYLOAD },
  { id: 'timerAdd', name: 'Add time', schema: TIMER_PAYLOAD },
];

export function ografManifest(""")
rep(p,"""  if (v.type === 'list') return { ...base, type: 'string', gddType: 'multi-line' };""","""  if (v.type === 'list') return { ...base, type: 'string', gddType: 'multi-line' };
  if (v.type === 'timer') return { ...base, type: 'string', description: 'A time (10:00); running: seconds@start time in ms' };""")
rep(p,"""Your own page""","""Timers${''}
  timer('start'), timer('stop'), timer('reset'), timer('add', 'clock', 60)
  on the page (CasparCG: CG 1-20 INVOKE 1 "timer('start')"); OGraf custom
  actions timerStart, timerStop, timerToggle, timerReset, timerAdd.

Your own page""")
