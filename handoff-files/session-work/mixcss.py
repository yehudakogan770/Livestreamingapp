p='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/views/ControlView.css'
s=open(p).read()
def rep(old,new,count=1):
    global s
    assert old in s, old[:80]
    s=s.replace(old,new,count)
rep('''  border-radius: var(--radius-sm);
  background: var(--bar);
  border: 1px solid var(--border);
  overflow: hidden;
}
.mixer__head {
  height: 30px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px 0 10px;
  border-bottom: 1px solid var(--border);
  background: var(--raised);
}''','''  border-radius: var(--radius);
  background: var(--panel);
  border: 1px solid var(--border);
  overflow: hidden;
}
.mixer__head {
  padding-right: 4px;
}''')
rep('''.strip {
  position: relative;
  width: 76px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 4px;
  border-radius: 0;
  background: transparent;
  border-right: 1px solid var(--border);
  box-shadow: inset 0 2px 0 transparent;
}
.strip--air {
  box-shadow: inset 0 2px 0 var(--program-bright);
}''','''.strip {
  position: relative;
  width: 76px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 6px 4px 4px;
  border-radius: 0;
  background: linear-gradient(#1a1d22, #15181c);
  border-right: 1px solid #0b0c0e;
  box-shadow:
    inset 1px 0 0 rgba(255, 255, 255, 0.03),
    inset 0 3px 0 transparent;
}
.strip--air {
  box-shadow:
    inset 1px 0 0 rgba(255, 255, 255, 0.03),
    inset 0 3px 0 var(--program-bright);
}''')
rep('''.strip--mix {
  background: var(--panel);
}''','''.strip--mix {
  background: linear-gradient(#1f2329, #1a1d22);
}''')
rep('''.strip__name {
  height: 20px;
  padding: 0 2px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
}''','''.strip__name {
  height: 22px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--well);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  color: var(--text);
}
.strip__name > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.strip__name svg.lucide {
  width: 11px;
  height: 11px;
  color: var(--text-faint);
}''')
rep('''.strip__name--mix {
  line-height: 20px;
  color: var(--text);
}''','''.strip__name--mix {
  line-height: 20px;
  border-color: transparent;
  background: transparent;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent);
}''')
rep('''.strip__db {
  font-family: var(--mono);
  font-size: 10px;
  text-align: center;
  color: var(--text-dim);''','''.strip__db {
  height: 18px;
  line-height: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--well);
  font-family: var(--mono);
  font-size: 10px;
  text-align: center;
  color: var(--text-dim);''')
rep('''.sbtn,
.send {
  height: 20px;
  padding: 0;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: var(--well);
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 700;
}''','''.sbtn,
.send {
  height: 22px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  border: 1px solid #0b0c0e;
  border-top-color: #3a3f47;
  background: linear-gradient(#2a2e35, #22262c);
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 700;
}
.sbtn svg.lucide {
  width: 12px;
  height: 12px;
}''')
rep('''.sbtn--mute.is-on {
  border-color: #b8463f;
  background: #6b2420;
  color: #fff;
}
.sbtn--solo.is-on {
  border-color: var(--warning);
  background: var(--warning-bg);
  color: var(--warning);
}''','''.sbtn--mute.is-on {
  border-color: #7d1712;
  border-top-color: #ff8a80;
  background: linear-gradient(#d8362d, #b02820);
  color: #fff;
}
.sbtn--solo.is-on {
  border-color: #6d4d0e;
  border-top-color: #ffd789;
  background: linear-gradient(#e7a935, #c38a1f);
  color: #1a1204;
}''')
rep('''.send {
  height: 16px;
  font-size: 9px;
  font-weight: 700;
}''','''.send {
  height: 16px;
  font-size: 9px;
  font-weight: 700;
  background: var(--well);
  border-color: var(--border);
  color: var(--text-faint);
}''')
rep('''.meter {
  position: relative;
  width: 10px;
  margin: 9px 0;
  border-radius: 0;
  background: #000;
  overflow: hidden;
}''','''.meter {
  position: relative;
  width: 10px;
  margin: 9px 0;
  border-radius: 1px;
  background: #050607;
  border: 1px solid #000;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.04);
  overflow: hidden;
}
/* LED segments: thin dark gaps across the bar. */
.meter::after {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(to top, transparent 0 3px, rgba(5, 6, 7, 0.9) 3px 4px);
  pointer-events: none;
}''')
rep('''  background: linear-gradient(to top, #2c9a4a 0%, #2c9a4a 66%, #d8b23a 80%, #e23c35 95%);''','''  background: linear-gradient(to top, #22b455 0%, #34d26b 66%, #f2b33d 80%, #ff4b3e 95%);''')
open(p,'w').write(s)
