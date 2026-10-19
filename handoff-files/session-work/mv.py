root='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/'
def edit(path, pairs):
    p=root+path
    s=open(p).read()
    for old,new in pairs:
        assert old in s, (path, old[:80])
        s=s.replace(old,new,1)
    open(p,'w').write(s)

edit('views/MultiviewView.css',[
('''.mv {
  position: fixed;
  inset: 0;
  background: #000;''','''.mv {
  position: fixed;
  inset: 0;
  background: var(--chrome);'''),
('''.mv__head {
  flex: 0 0 auto;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
  font-size: 14px;
  font-weight: 600;
}
.mv__clock {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 18px;
}''','''.mv__head {
  flex: 0 0 auto;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.mv__clock {
  margin-left: auto;
  height: 26px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #000;
  font-family: var(--mono);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: none;
}'''),
('''  border: 2px solid #2a2a2c;
  border-radius: 0;
  background: #000;
  overflow: hidden;
}''','''  border: 1px solid #23272d;
  border-radius: 0;
  background: #000;
  overflow: hidden;
}'''),
('''.mv__box--pgm {
  border-color: var(--program-bright);
}
.mv__box--pvw {
  border-color: var(--preview-bright);
}''','''.mv__box--pgm {
  border-color: var(--program-bright);
  box-shadow: inset 0 0 0 1px var(--program-bright);
}
.mv__box--pvw {
  border-color: var(--preview-bright);
  box-shadow: inset 0 0 0 1px var(--preview-bright);
}'''),
('''.mv__label {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 8px;
  background: #111;
  font-size: 13px;
  font-weight: 400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-top: 1px solid #2a2a2c;
}''','''.mv__label {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px 3px;
  background: #101215;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-top: 1px solid #000;
}
/* The tally bar across the top of the label strip. */
.mv__box--pgm .mv__label::before,
.mv__box--pvw .mv__label::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 3px;
  background: var(--program-bright);
}
.mv__box--pvw .mv__label::before {
  background: var(--preview-bright);
}'''),
])
