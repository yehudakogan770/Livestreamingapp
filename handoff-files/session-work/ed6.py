import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='Designer.tsx'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''    return initial && l.leftTab === 'library' ? { ...l, leftTab: 'project' } : l;''','''    // Opened with a title: its Project panel rather than the library.
    return initial && findPanel(l.docks, 'library') && l.docks[findPanel(l.docks, 'library')!.side].some((g) => g.active === 'library')
      ? { ...l, docks: showPanel(l.docks, 'project') }
      : l;''')
rep('''  const side = layout.leftTab;
  const setSide = (leftTab: LeftTab) => setLayout({ leftTab, canvasOnly: false });
  const right = layout.rightTab;
  const setRight = (rightTab: RightTab) => setLayout({ rightTab });''','''  /** Bring a panel to the front (wherever it is docked). */
  const setSide = (id: PanelId) => setLayout((l) => ({ docks: showPanel(l.docks, id), canvasOnly: false }));
  const setDocks = (docks: Docks) => setLayout({ docks });
  const dock = useDockDrag(layout.docks, setDocks);''')
# replace the left aside
a=s.index('          <aside className="tt-left">')
b=s.index('          <section className="tt-center">')
s=s[:a]+'''          <DockSide side="left" docks={layout.docks} onDocks={setDocks} render={renderPanel} dragging={!!dock.drag} begin={dock.begin}>
            {layout.docks.left.length > 0 && (
              <Splitter
                axis="x"
                edge="right"
                value={layout.left}
                onChange={(left) => setLayout({ left: clampSize('left', left) })}
                label="Resize the left panel"
              />
            )}
          </DockSide>
'''+s[b:]
a=s.index('          <aside className="tt-right">')
b=s.index('        <div className="tt-timeline-wrap">')
s=s[:a]+'''          <DockSide side="right" docks={layout.docks} onDocks={setDocks} render={renderPanel} dragging={!!dock.drag} begin={dock.begin}>
            {layout.docks.right.length > 0 && (
              <Splitter axis="x" edge="left" value={layout.right} onChange={(r) => setLayout({ right: clampSize('right', r) })} label="Resize the right panel" />
            )}
          </DockSide>
          <DockOverlay drag={dock.drag} docks={layout.docks} />
        </div>
'''+s[b:]
rep('''        style={{ '--tt-left': `${layout.left}px`, '--tt-right': `${layout.right}px`, '--tt-timeline': `${layout.timeline}px` } as React.CSSProperties}''','''        style={
          {
            '--tt-left': `${layout.docks.left.length ? layout.left : 0}px`,
            '--tt-right': `${layout.docks.right.length ? layout.right : 0}px`,
            '--tt-timeline': `${layout.timeline}px`,
          } as React.CSSProperties
        }''')
rep('''  const rootRef = useRef<HTMLDivElement>(null);
  const c = compOf(project, store.get().compId);''','''  const rootRef = useRef<HTMLDivElement>(null);
  const c = compOf(project, store.get().compId);
  /** What each docked panel shows. */
  const renderPanel = (id: PanelId) => {
    switch (id) {
      case 'library':
        return (
          <>
            {recent.length > 0 && (
              <div className="tt-recent" aria-label="Recent titles">
                <div className="tt-recent-head">Recent</div>
                {recent.slice(0, 5).map((r) => (
                  <button key={r.id} className="tt-recent-item" title={r.id} onClick={() => void openRecent(r.id)}>
                    {r.name}
                  </button>
                ))}
              </div>
            )}
            <LibraryPanel key={libVersion} store={store} host={host} env={env} onOpen={(p, id) => open(p, id)} />
          </>
        );
      case 'project':
        return <ProjectPanel store={store} host={host} />;
      case 'history':
        return (
          <>
            <NotesPanel store={store} />
            <HistoryPanel store={store} />
          </>
        );
      case 'layer':
        return <Inspector store={store} />;
      case 'comp':
        return <CompositionPanel store={store} />;
      case 'fields':
        return <FieldsPanel store={store} host={host} />;
      case 'look':
        return <LookPanel store={store} host={host} />;
      case 'data':
        return <DataPanel store={store} />;
    }
  };''')
rep('''  type Layout,
  type LeftTab,
  type RightTab,
  type WorkspaceName,
} from './workspace';''','''  type Docks,
  type Layout,
  type PanelId,
  type WorkspaceName,
  findPanel,
  showPanel,
} from './workspace';
import { DockOverlay, DockSide, useDockDrag } from './Dock';''')
open(p,'w').write(s)
