root='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/'
def edit(path, pairs):
    p=root+path
    s=open(p).read()
    for old,new in pairs:
        assert old in s, (path, old[:80])
        s=s.replace(old,new,1)
    open(p,'w').write(s)
edit('views/VisualsPage.css',[
('''.vis__mid,
.vis__right {
  border-left: 1px solid var(--border);
}''','''.vis__mid,
.vis__right {
  border-left: 1px solid #000;
  box-shadow: inset 1px 0 0 rgba(255, 255, 255, 0.035);
}
.vis__left,
.vis__right {
  background: var(--bar);
}'''),
('''.vis__live {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: var(--radius);
  overflow: hidden;
  background: #000;
  flex: 0 0 auto;
}''','''.vis__live {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 0;
  border: 1px solid #23272d;
  overflow: hidden;
  background: #000;
  flex: 0 0 auto;
}'''),
('''  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--button);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  touch-action: none;
}''','''  border-radius: var(--radius-sm);
  border: 1px solid #0b0c0e;
  border-top-color: #3a3f47;
  background: linear-gradient(#2c3037, #24282e);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  touch-action: none;
}
.vis__pad:hover:not(:disabled) {
  background: linear-gradient(#343941, #2b3036);
}'''),
('''.vis__pad small {
  font-size: 10px;
  font-weight: 400;
  color: var(--text-faint);
}
.vis__pad.is-on {
  border-color: var(--accent);
  background: var(--selected);
}''','''.vis__pad small {
  font-family: var(--mono);
  font-size: 9.5px;
  font-weight: 500;
  color: var(--text-faint);
}
.vis__pad.is-on {
  border-color: #0f4a52;
  border-top-color: #9be0e8;
  background: linear-gradient(#4fb3bf, #2c8f9b);
  color: #04181b;
}
.vis__pad.is-on small {
  color: #0d3a40;
}'''),
])
