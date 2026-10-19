import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
def rep(p, old, new):
    s = open(p).read()
    assert old in s, (p, old)
    s = s.replace(old, new, 1)
    open(p, 'w').write(s)

p = 'app/src/components/MonitorScreen.tsx'
rep(p, """  const left = c ? countdownRemaining(c, now) : 0;
  const done = c ? countdownFinished(c, now) : false;
  const urgent = !!c && c.endsAt !== null && left < 60_000;
  const timerText = !c ? '' : done && c.atZero.type === 'showText' ? c.endText : formatCountdown(left, c.format === 'auto' ? 'minSec' : c.format);
""", """  const st = c ? stageTimer(c, m, now) : null;
""")
rep(p, """  const timer = m.showTimer && c && (
    <div className={`mscreen__cell mscreen__timer${urgent ? ' is-urgent' : ''}${c.endsAt === null ? ' is-paused' : ''}`}>
      <span className="mscreen__tag">{c.endsAt === null ? 'COUNTDOWN · WAITING' : 'TIME LEFT'}</span>
      <span className="mscreen__num">{timerText}</span>
    </div>
  );""", """  const timer = m.showTimer && c && st && (
    <div className={`mscreen__cell mscreen__timer is-${st.tone}`} data-tone={st.tone}>
      <span className="mscreen__tag">{st.tone === 'paused' ? 'COUNTDOWN · WAITING' : st.tone === 'over' ? 'OVERTIME' : 'TIME LEFT'}</span>
      <span className="mscreen__num">{st.text}</span>
      {st.gone !== null && (
        <span className="mscreen__bar" aria-hidden="true">
          <i style={{ width: `${(st.gone * 100).toFixed(1)}%` }} />
        </span>
      )}
    </div>
  );""")
rep(p, """import { FLASH_MS, countdownFinished, countdownRemaining, fadeAmount, formatCountdown } from '../engine/timing';""",
"""import { FLASH_MS, fadeAmount } from '../engine/timing';
import { stageTimer } from '../engine/stageTimer';""")

p = 'app/src/components/MonitorScreen.css'
rep(p, """.mscreen__timer.is-urgent .mscreen__num {
  color: #ff5a4f;
}
.mscreen__timer.is-paused .mscreen__num {
  color: #a9abb0;
}""", """.mscreen__timer.is-urgent .mscreen__num,
.mscreen__timer.is-over .mscreen__num,
.mscreen__timer.is-over .mscreen__tag {
  color: #ff5a4f;
}
.mscreen__timer.is-wrapUp .mscreen__num {
  color: #f2b33d;
}
.mscreen__timer.is-paused .mscreen__num {
  color: #a9abb0;
}
/* How much of the time has gone. */
.mscreen__bar {
  display: block;
  align-self: stretch;
  height: 0.6vh;
  min-height: 4px;
  margin-top: 0.8vh;
  background: #2a2d33;
  overflow: hidden;
}
.mscreen__bar i {
  display: block;
  height: 100%;
  background: #d9d9d6;
}
.mscreen__timer.is-wrapUp .mscreen__bar i {
  background: #f2b33d;
}
.mscreen__timer.is-urgent .mscreen__bar i,
.mscreen__timer.is-over .mscreen__bar i {
  background: #ff5a4f;
}""")
