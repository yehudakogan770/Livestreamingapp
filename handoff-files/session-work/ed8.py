import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='Designer.tsx'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''          <label className="tt-workspace" title="Workspace: panel sizes and tabs for the job at hand">
            <span className="tt-dim">Workspace</span>
            <select
              className="tt-select"
              aria-label="Workspace"
              value={layout.workspace}
              onChange={(e) => setLayout(workspace(e.target.value as WorkspaceName))}
            >
              {(Object.keys(WORKSPACE_NAMES) as WorkspaceName[]).map((w) => (
                <option key={w} value={w}>
                  {WORKSPACE_NAMES[w]}
                </option>
              ))}
            </select>
          </label>''','''          <MenuButton
            className="tt-workspace"
            align="right"
            title="Workspace: the panels and their sizes for the job at hand"
            label={
              <>
                <span className="tt-dim">Workspace</span> {WORKSPACE_NAMES[layout.workspace]}
              </>
            }
          >
            {(close) => (
              <>
                {(Object.keys(WORKSPACE_NAMES) as WorkspaceName[]).map((w) => (
                  <MenuItem key={w} chosen={layout.workspace === w} onClick={() => (setLayout(workspace(w)), close())}>
                    {WORKSPACE_NAMES[w]}
                  </MenuItem>
                ))}
                <MenuSep />
                <MenuItem onClick={() => (setLayout(workspace(layout.workspace)), close())}>Reset {WORKSPACE_NAMES[layout.workspace]}</MenuItem>
                <div className="tt-menu-note">Drag a panel by its tab to dock it in another group, above or below one, or on the other side.</div>
              </>
            )}
          </MenuButton>''')
rep('''              <span className="tt-grow" />
              {(
                [
                  ['safe', 'Safe areas'],
                  ['guides', 'Guides'],
                  ['grid', 'Grid'],
                  ['rulers', 'Rulers'],
                  ['snap', 'Snapping'],
                  ['motionPaths', 'Motion paths'],
                  ['notes', 'Notes'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="tt-check">
                  <input type="checkbox" checked={show[k]} onChange={(e) => store.set((x) => ({ show: { ...x.show, [k]: e.target.checked } }))} />
                  {label}
                </label>
              ))}''','''              <span className="tt-grow" />
              <MenuButton label="View" title="Guides and helpers on the canvas" align="right">
                {() => (
                  <>
                    {(
                      [
                        ['safe', 'Safe areas', ''],
                        ['guides', 'Guides', ''],
                        ['grid', 'Grid', ''],
                        ['rulers', 'Rulers', ''],
                        ['snap', 'Snapping', ''],
                        ['motionPaths', 'Motion paths', ''],
                        ['notes', 'Notes', ''],
                      ] as const
                    ).map(([k, label]) => (
                      <MenuCheck key={k} checked={show[k]} onChange={(v) => store.set((x) => ({ show: { ...x.show, [k]: v } }))}>
                        {label}
                      </MenuCheck>
                    ))}
                  </>
                )}
              </MenuButton>''')
rep("import { DockOverlay, DockSide, useDockDrag } from './Dock';","import { DockOverlay, DockSide, useDockDrag } from './Dock';\nimport { MenuButton, MenuCheck, MenuItem, MenuSep } from './MenuButton';")
open(p,'w').write(s)

p='designer.css'; s=open(p).read()
s+='''
/* ---- menus under a button (View, Workspace) ---- */
.tt-menuwrap {
  position: relative;
  display: inline-flex;
}
.tt-menubtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  border-radius: var(--tt-radius);
  white-space: nowrap;
}
.tt-menubtn:hover,
.tt-menubtn.on {
  background: var(--tt-hover);
}
.tt-menu-pop {
  position: absolute;
  top: calc(100% + 4px);
  z-index: 45;
  min-width: 190px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  background: var(--tt-raised);
  border: 1px solid var(--tt-line-2);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.tt-menu-pop.left {
  left: 0;
}
.tt-menu-pop.right {
  right: 0;
}
.tt-menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px 5px 4px;
  border-radius: var(--tt-radius);
  text-align: left;
  white-space: nowrap;
}
.tt-menu-item:hover,
.tt-menu-item:focus-visible {
  background: var(--tt-selected);
  outline: none;
}
.tt-menu-tick {
  width: 16px;
  text-align: center;
  color: var(--tt-text);
}
.tt-menu-label {
  flex: 1;
}
.tt-menu-hint {
  font: 10.5px var(--tt-mono);
  color: var(--tt-faint);
}
.tt-menu-sep {
  height: 1px;
  margin: 4px 2px;
  background: var(--tt-line);
}
.tt-menu-note {
  max-width: 230px;
  padding: 4px 8px 6px 26px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--tt-faint);
  white-space: normal;
}
'''
s=s.replace('''.tt-workspace {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 10px;
}''','''.tt-workspace {
  margin-right: 8px;
}''')
open(p,'w').write(s)
