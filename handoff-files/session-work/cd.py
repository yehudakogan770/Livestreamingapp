root='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/'
def edit(path, pairs, imp=None):
    p=root+path
    s=open(p).read()
    for old,new in pairs:
        assert old in s, (path, old[:80])
        s=s.replace(old,new,1)
    if imp:
        i=s.index('import ')
        s=s[:i]+imp+'\n'+s[i:]
    open(p,'w').write(s)

edit('views/CountdownCard.tsx',[
('''        ⏱ Countdown
      </button>''','''        <Timer aria-hidden="true" />
        Countdown
      </button>'''),
('''        <span className="cdm__name">{c.label || name}</span>''','''        <Timer className="cdm__icon" aria-hidden="true" />
        <span className="cdm__name">{c.label || name}</span>'''),
('''          {running && !done ? 'Pause' : done ? 'Reset' : 'Start'}
        </button>
        <button type="button" className="btn btn--small" aria-expanded={open} aria-label="All countdown controls" onClick={() => setOpen(!open)}>
          {open ? '▴' : '▾'}
        </button>''','''          {running && !done ? <Pause aria-hidden="true" /> : done ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}
          {running && !done ? 'Pause' : done ? 'Reset' : 'Start'}
        </button>
        <button type="button" className="btn btn--small" aria-expanded={open} aria-label="All countdown controls" onClick={() => setOpen(!open)}>
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>'''),
], "import { ChevronDown, ChevronUp, Pause, Play, RotateCcw, Timer } from 'lucide-react';")

edit('views/ControlView.css',[
('''.cdm {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bar);
}''','''.cdm {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 6px 6px 8px;
  border: 1px solid #2a2f36;
  border-radius: var(--radius);
  background: linear-gradient(#1a1d22, #15171b);
  box-shadow: inset 0 1px 0 var(--hi);
}
.cdm__icon {
  color: var(--accent);
}'''),
('''.cdm__time {
  padding: 0 4px;
  border: 1px dashed transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  font-family: var(--mono);
  font-size: 18px;
  font-weight: 400;
  cursor: text;
}''','''.cdm__time {
  height: 28px;
  padding: 0 6px;
  border: 1px solid #000;
  border-radius: var(--radius);
  background: var(--well);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
  color: var(--text);
  font-family: var(--mono);
  font-size: 17px;
  font-weight: 600;
  cursor: text;
}'''),
])
