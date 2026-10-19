import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/designer/Panels.tsx'
rep(p,"""  ['list', 'List'],
];""","""  ['list', 'List'],
  ['timer', 'Timer (clock, countdown)'],
];""")
rep(p,"""              <Select label="Field kind" value={v.type} options={VAR_TYPES} onChange={(type) => set(i, { type })} />""","""              <Select
                label="Field kind"
                value={v.type}
                options={VAR_TYPES}
                onChange={(type) => set(i, type === 'timer' ? { type, timer: v.timer ?? { dir: 'down', format: 'm:ss' }, value: /^[\\d:.]+$/.test(v.value) ? v.value : '10:00' } : { type })}
              />""")
rep(p,"""            {v.type === 'list' && (
              <Row label="On one line\"""","""            {v.type === 'timer' && (
              <>
                <Row label="Runs" hint="The sample is where it starts (10:00, 45:00, 0:00)">
                  <Select
                    label="Timer direction"
                    value={v.timer?.dir ?? 'down'}
                    options={[
                      ['down', 'Down (countdown)'],
                      ['up', 'Up (stopwatch, game clock)'],
                    ]}
                    onChange={(dir) => set(i, { timer: { ...(v.timer ?? { dir }), dir } })}
                  />
                  <Select
                    label="Timer shows"
                    value={v.timer?.format ?? 'm:ss'}
                    options={[
                      ['m:ss', '9:05'],
                      ['mm:ss', '09:05'],
                      ['h:mm:ss', '1:09:05'],
                      ['ss', '545'],
                      ['m:ss.t', '9:05.3'],
                      ['ss.t', '24.3 (shot clock)'],
                    ]}
                    onChange={(format) => set(i, { timer: { ...(v.timer ?? { dir: 'down' }), format } })}
                  />
                </Row>
                <Row label="Stops at" hint="Empty: a countdown stops at 0, a clock counting up runs on">
                  <input
                    className="tt-input short"
                    aria-label="Timer stops at"
                    placeholder={v.timer?.dir === 'up' ? '(runs on)' : '0:00'}
                    defaultValue={v.timer?.stop !== undefined ? String(v.timer.stop) : ''}
                    onBlur={(e) => {
                      const n = parseClock(e.target.value);
                      set(i, { timer: { ...(v.timer ?? { dir: 'down' }), stop: Number.isFinite(n) ? n : undefined } });
                    }}
                  />
                  <Toggle value={!!v.timer?.auto} onChange={(auto) => set(i, { timer: { ...(v.timer ?? { dir: 'down' }), auto } })} label="Starts when taken" />
                </Row>
              </>
            )}
            {v.type === 'list' && (
              <Row label="On one line\"""")
s=open(p).read()
if "parseClock" not in s.split("export function")[0]:
    s=s.replace("import { PackDialog } from './PackDialog';","import { PackDialog } from './PackDialog';\nimport { parseClock } from '../core/timer';",1)
open(p,'w').write(s)

p='titler/src/designer/ControlPanel.tsx'
rep(p,"""  } else if (v.type === 'list') {""","""  } else if (v.type === 'timer') {
    input = <TimerControl id={id} v={v} value={value} onChange={onChange} />;
  } else if (v.type === 'list') {""")
rep(p,"import type { TitleProject, Values, Variable } from '../core/types';","import { useEffect, useState } from 'react';\nimport { parseTimer, timerCommand, timerRunning, timerText } from '../core/timer';\nimport type { TitleProject, Values, Variable } from '../core/types';")
s=open(p).read()
s+='''
/** A timer's buttons: start / stop, reset, a minute (or a second) more or less, and the time typed in. */
function TimerControl({ id, v, value, onChange }: { id: string; v: Variable; value: string; onChange: (x: string) => void }) {
  const running = timerRunning(value);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [running]);
  const now = Date.now();
  const shown = timerText({ ...v, timer: v.timer ? { ...v.timer, auto: false } : v.timer }, value, now, null);
  const step = (v.timer?.format ?? '').includes('.t') || v.timer?.format === 'ss' ? 1 : 60;
  const cmd = (c: 'toggle' | 'reset' | 'add', amount = 0) => onChange(timerCommand(v, value, c, Date.now(), amount));
  return (
    <span className="tt-cp-timer">
      <input
        id={id}
        key={running ? 'run' : value}
        className="tt-cp-timer-time"
        defaultValue={shown}
        readOnly={running}
        aria-label={`${v.label} time`}
        onBlur={(e) => {
          if (running) return;
          const s = parseTimer(e.target.value);
          if (e.target.value.trim() && Number.isFinite(s.secs)) onChange(String(s.secs));
        }}
        value={running ? shown : undefined}
      />
      <button type="button" className={running ? 'on' : ''} onClick={() => cmd('toggle')} aria-label={running ? `Stop ${v.label}` : `Start ${v.label}`}>
        {running ? 'Stop' : 'Start'}
      </button>
      <button type="button" onClick={() => cmd('add', -step)} aria-label={`${v.label} ${step === 60 ? 'a minute' : 'a second'} less`}>
        −
      </button>
      <button type="button" onClick={() => cmd('add', step)} aria-label={`${v.label} ${step === 60 ? 'a minute' : 'a second'} more`}>
        +
      </button>
      <button type="button" onClick={() => cmd('reset')} aria-label={`Reset ${v.label}`}>
        Reset
      </button>
    </span>
  );
}
'''
open(p,'w').write(s)
s=open('titler/src/designer/controlPanel.css').read()
s+='''.tt-cp-timer {
  display: flex;
  gap: 4px;
  align-items: center;
}
.tt-cp-timer .tt-cp-timer-time {
  width: 84px;
  font-variant-numeric: tabular-nums;
}
.tt-cp-timer button.on {
  font-weight: 600;
}
'''
open('titler/src/designer/controlPanel.css','w').write(s)
