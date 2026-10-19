root='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/'
def edit(path, pairs):
    p=root+path
    s=open(p).read()
    for old,new in pairs:
        assert old in s, (path, old[:80])
        s=s.replace(old,new,1)
    open(p,'w').write(s)

edit('views/ControlView.css',[
('''.presets__list {
  padding: 6px !important;
}
''',''),
('''.presets__list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;''','''.presets__list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 6px;'''),
('''.part--presets.is-right .presets {
  padding: 12px 12px 12px 0;
}''','''.part--presets.is-right .presets {
  border-right: 0;
  border-left: 1px solid #000;
}'''),
('''/* ---- inputs + mixer ---- */
.inputs-area {
  display: flex;
  gap: 12px;
}
.inputs-area__grid {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.inputs-area__grid > .inputs {
  /* The tiles share out all the room (sized by InputGrid): no gaps, no scrolling. */
  flex: 1;
  min-height: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 8px;
}''','''/* ---- inputs + mixer ---- */
.inputs-area {
  display: flex;
  gap: 8px;
}
.inputs-area__grid {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel);
}
.inputs-area__grid > .phead {
  margin-bottom: 0;
}
.phead__hint {
  margin-left: auto;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
}
.inputs-area__grid > .pbuttons {
  margin: 0;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.inputs-area__grid > .inputs {
  /* The tiles share out all the room (sized by InputGrid): no gaps, no scrolling. */
  flex: 1;
  min-height: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 8px;
  padding: 8px;
}'''),
('''.inputs-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 10px 10px;
}''','''.inputs-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}'''),
])
