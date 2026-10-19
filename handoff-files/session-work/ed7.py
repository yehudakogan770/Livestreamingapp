import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='designer.css'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''.tt-tabs {
  display: flex;
  gap: 2px;
  padding: 4px;
  border-bottom: 1px solid var(--tt-line);
  background: var(--tt-bar);
  flex-wrap: wrap;
}
.tt-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: var(--tt-radius);
  color: var(--tt-dim);
}''','''.tt-tabs {
  display: flex;
  flex: none;
  gap: 2px;
  padding: 4px;
  border-bottom: 1px solid var(--tt-line);
  background: var(--tt-bar);
  overflow-x: auto;
  scrollbar-width: none;
}
.tt-tabs::-webkit-scrollbar {
  display: none;
}
.tt-tabs button {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: var(--tt-radius);
  color: var(--tt-dim);
  white-space: nowrap;
}
.tt-tabs button:hover:not(.on) {
  color: var(--tt-text);
}''')
rep('''.tt-main {
  grid-area: main;''','''.tt-main {
  position: relative;
  grid-area: main;''')
s+='''
/* ---- docked panels ---- */
.tt-dock {
  overflow: hidden;
}
.tt-dock-group {
  display: flex;
  flex-direction: column;
  flex-shrink: 1;
  min-height: 90px;
  overflow: hidden;
}
.tt-dock-body {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.tt-dock-body > * {
  flex-shrink: 0;
}
.tt-dock-body > .tt-side-list,
.tt-dock-body > .tt-library {
  flex-shrink: 1;
}
.tt-dock-split {
  flex: none;
  height: 5px;
  background: var(--tt-line);
  cursor: row-resize;
}
.tt-dock-split:hover,
.tt-dock-split.on,
.tt-dock-split:focus-visible {
  background: var(--tt-line-2);
  outline: none;
}
.tt-dock.tt-dragging .tt-tabs button {
  cursor: grabbing;
}
.tt-dock-mark {
  position: fixed;
  z-index: 50;
  pointer-events: none;
  border: 1px solid color-mix(in srgb, var(--tt-select) 70%, transparent);
  background: color-mix(in srgb, var(--tt-select) 12%, transparent);
  border-radius: 3px;
}
.tt-dock-mark.line {
  border: 0;
  background: var(--tt-select);
}
.tt-dock-ghost {
  position: fixed;
  z-index: 51;
  pointer-events: none;
  padding: 3px 9px;
  font-size: 12px;
  color: var(--tt-text);
  background: var(--tt-raised);
  border: 1px solid var(--tt-line-2);
  border-radius: var(--tt-radius);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}
.tt-dock-edge {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 30;
  width: 40px;
  display: grid;
  place-items: center;
  color: var(--tt-dim);
  font-size: 11px;
  background: var(--tt-panel);
  border: 1px dashed var(--tt-line-2);
}
.tt-dock-edge.left {
  left: 0;
}
.tt-dock-edge.right {
  right: 0;
}
.tt-dock-edge span {
  writing-mode: vertical-rl;
  pointer-events: none;
}
'''
open(p,'w').write(s)
