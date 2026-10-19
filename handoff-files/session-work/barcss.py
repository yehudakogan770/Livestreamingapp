root='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/'
def edit(path, pairs, append=None):
    p=root+path
    s=open(p).read()
    for old,new in pairs:
        assert old in s, (path, old[:80])
        s=s.replace(old,new,1)
    if append:
        s+=append
    open(p,'w').write(s)

edit('views/ControlView.css',[
('''.bar {
  flex: 0 0 auto;
  height: 46px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  background: var(--bar);
  border-top: 1px solid var(--border);
}''','''/* The status bar: a dark strip of grouped controls, hairlines between groups. */
.bar {
  flex: 0 0 auto;
  height: 44px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  background: linear-gradient(#121418, #0d0f12);
  border-top: 1px solid #000;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.045);
}
.bar > .plight,
.bar > .btn,
.bar > .bc-replay,
.bar > .perf {
  position: relative;
}
/* Hairline dividers after the problem light, Back = Live and the broadcast group. */
.bar > .plight,
.bar > .btn[aria-pressed] {
  margin-right: 6px;
}
.bar > .plight::after,
.bar > .btn[aria-pressed]:not(.bc-btn)::after {
  content: '';
  position: absolute;
  right: -6px;
  top: 4px;
  bottom: 4px;
  width: 1px;
  background: var(--border-strong);
}
.bar__group {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px;
  margin-right: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--well);
}
.bar__group .btn {
  height: 26px;
}'''),
('''.bar__label {
  color: var(--text-faint);
  font-size: 12px;
}''','''.bar__label {
  padding: 0 6px 0 4px;
  color: var(--text-faint);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}'''),
('''.bar__lamps i {
  width: 6px;
  height: 6px;
  border-radius: 1px;
  background: var(--border-strong);
}''','''.bar__lamps i {
  width: 6px;
  height: 10px;
  border-radius: 1px;
  background: #30353d;
  box-shadow: inset 0 1px 0 rgba(0, 0, 0, 0.4);
}'''),
('''.btn--blank.is-on {
  border-color: var(--text);
  background: #000;
  color: #fff;
}
.btn--panic {
  min-width: 132px;
  justify-content: center;
  border-color: #6e2622;
  background: #2e1513;
  color: #f0b4ae;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.btn--panic:hover:not(:disabled) {
  background: #3e1a17;
}''','''.btn--blank.is-on {
  border-color: var(--text);
  background: #000;
  color: #fff;
}
.btn--blank.is-on svg.lucide {
  color: #fff;
}
.btn--panic {
  min-width: 140px;
  height: 32px;
  justify-content: center;
  border-color: #7d1712;
  border-top-color: #b8463f;
  background: repeating-linear-gradient(-45deg, #3a1512 0 8px, #301210 8px 16px);
  color: #ffb3ab;
  font-weight: 800;
  letter-spacing: 0.1em;
}
.btn--panic svg.lucide {
  color: #ff8a80;
}
.btn--panic:hover:not(:disabled) {
  background: repeating-linear-gradient(-45deg, #4a1a16 0 8px, #3e1714 8px 16px);
}'''),
])

edit('broadcast/broadcast.css',[
('''.bc-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}
.bc-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-faint);
}''','''.bc-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-weight: 700;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
}
/* The record lamp: a red dot that lights up while recording. */
.bc-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #6b2420;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.4);
}'''),
('''.bc-btn--rec .bc-dot,
.bc-btn--live .bc-dot {
  background: #fff;
  animation: bc-blink 1.2s steps(1) infinite;
}''','''.bc-btn--rec .bc-dot,
.bc-btn--live .bc-dot,
.bc-btn--live .bc-live {
  background: #fff;
  animation: bc-blink 1.2s steps(1) infinite;
}
.bc-btn--live .bc-live {
  background: none;
  color: #fff;
}
.bc-btn--rec,
.bc-btn--live {
  border-top-color: #ff8a80;
}'''),
])

edit('problems/problems.css',[
('''.plight__btn--ok {
  border-color: var(--border-strong);
  color: var(--text);
}''','''.plight__btn--ok {
  color: var(--text);
}
.plight__btn--ok svg.lucide {
  color: var(--preview-bright) !important;
}
.plight__btn--warning svg.lucide,
.plight__btn--error svg.lucide {
  color: currentColor !important;
}'''),
('''.plist {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 70;
  width: 420px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 0;
  border-radius: var(--radius);
  background: var(--raised);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-pop);
}
.plist__none {
  margin: 6px;
  color: var(--text-dim);
}''','''.plist {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 70;
  width: 440px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  border-radius: var(--radius);
  background: var(--panel);
  border: 1px solid var(--border-strong);
  box-shadow:
    inset 0 1px 0 var(--hi),
    var(--shadow-pop);
}
.plist__head {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 36px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px 0 12px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(#22262c, #1d2025);
  font-size: 13px;
  font-weight: 600;
}
.plist__head > svg.lucide {
  color: var(--accent);
}
.plist__count {
  min-width: 20px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--button);
  font-family: var(--mono);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  color: var(--text-dim);
}
.plist__head .icon {
  margin-left: auto;
}
.plist__none {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 16px 12px;
  color: var(--text-dim);
}
.plist__none svg.lucide {
  color: var(--preview-bright);
}'''),
('''.pitem {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;''','''.pitem {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;'''),
('''.pitem__title {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-weight: 600;
}''','''.pitem__title {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-weight: 600;
}
.pitem__title > svg.lucide {
  margin-top: 1px;
}
.pitem--error .pitem__title > svg.lucide {
  color: var(--danger);
}
.pitem--warning .pitem__title > svg.lucide {
  color: var(--warning);
}
.pitem__text {
  flex: 1 1 auto;
}'''),
('''.pitem__detail {
  color: var(--text-dim);
  font-size: 12px;
}
.pitem__fix {
  font-size: 12px;
}
.pitem__act {
  align-self: flex-start;
  margin-top: 4px;
  height: 28px;
}''','''.pitem__detail {
  padding-left: 22px;
  color: var(--text-dim);
  font-size: 12px;
}
.pitem__fix {
  display: flex;
  gap: 8px;
  margin-top: 2px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--well);
  border: 1px solid var(--border);
  font-size: 12px;
}
.pitem__fix svg.lucide {
  width: 12px;
  height: 12px;
  margin-top: 2px;
  color: var(--accent);
}
.pitem__act {
  align-self: flex-start;
  margin: 2px 0 0 22px;
  height: 28px;
}
.ptoast strong {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ptoast--error strong svg.lucide {
  color: var(--danger);
}
.ptoast--warning strong svg.lucide {
  color: var(--warning);
}'''),
('''.tile__warn {
  position: absolute;
  left: 30px;
  top: 4px;
  height: 16px;
  padding: 0 6px;''','''.tile__warn {
  position: absolute;
  left: 34px;
  top: 5px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  padding: 0 5px;'''),
])
