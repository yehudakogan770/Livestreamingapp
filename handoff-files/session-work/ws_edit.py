import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
p = 'titler/src/designer/Designer.tsx'
s = open(p).read()

s = s.replace("""  const [side, setSide] = useState<'library' | 'project'>(initial ? 'project' : 'library');
  const [right, setRight] = useState<'layer' | 'comp' | 'fields' | 'look' | 'data'>('layer');""", """  const [layout, setLayoutState] = useState<Layout>(() => {
    const l = loadLayout();
    return initial && l.leftTab === 'library' ? { ...l, leftTab: 'project' } : l;
  });
  const setLayout = (patch: Partial<Layout> | ((l: Layout) => Partial<Layout>)) =>
    setLayoutState((l) => {
      const next = { ...l, ...(typeof patch === 'function' ? patch(l) : patch) };
      saveLayout(next);
      return next;
    });
  const side = layout.leftTab;
  const setSide = (leftTab: LeftTab) => setLayout({ leftTab, canvasOnly: false });
  const right = layout.rightTab;
  const setRight = (rightTab: RightTab) => setLayout({ rightTab });
  const [recent, setRecent] = useState(recentTitles);""")

# Remember what is opened.
s = s.replace("""  const open = (p: TitleProject, id?: string | null, path?: string | null) => {
    if (store.get().dirty && !confirm('Open another title? Changes to this one that are not saved will be lost.')) return;
    store.load(p, { path: path ?? null });
    setLibId(id ?? null);
    setSide('project');
    host.autosave(null);
  };""", """  const open = (p: TitleProject, id?: string | null, path?: string | null) => {
    if (store.get().dirty && !confirm('Open another title? Changes to this one that are not saved will be lost.')) return;
    store.load(p, { path: path ?? null });
    setLibId(id ?? null);
    setSide('project');
    host.autosave(null);
    const again = id ?? path;
    if (again) setRecent(rememberTitle(again, p.name));
  };

  const openRecent = async (id: string) => {
    const r = await host.readLibrary(id);
    if (r.project) open(r.project, host.kind === 'web' ? id : null, host.kind === 'web' ? null : id);
    else {
      setRecent(forgetTitle(id));
      store.set({ status: 'That title is no longer there.' });
    }
  };""")

s = s.replace("""      const id = await host.saveLibrary(store.get().project, libId);
      setLibId(id);""", """      const id = await host.saveLibrary(store.get().project, libId);
      setLibId(id);
      setRecent(rememberTitle(id, store.get().project.name));
      void saveVersion(store.get().project, 'Saved').catch(() => {});""")

# Keyboard: ` for the canvas on its own.
s = s.replace("""      if (mod && k === 'z') return (handled(), e.shiftKey ? store.redo() : store.undo());""", """      if (!mod && e.key === '`') return (handled(), setLayout((l) => ({ canvasOnly: !l.canvasOnly })));
      if (mod && k === 'z') return (handled(), e.shiftKey ? store.redo() : store.undo());""")

# Root: sizes as CSS variables, canvas-only class.
s = s.replace("""    <div className={`tt tt-look-${look}`} ref={rootRef} data-testid="titler-designer">""", """    <div
      className={`tt tt-look-${look}${layout.canvasOnly ? ' tt-canvas-only' : ''}`}
      ref={rootRef}
      data-testid="titler-designer"
      style={{ '--tt-left': `${layout.left}px`, '--tt-right': `${layout.right}px`, '--tt-timeline': `${layout.timeline}px` } as React.CSSProperties}
    >""")

# Workspace menu in the top bar (before the title).
s = s.replace("""        <span className="tt-grow" />
        <span className="tt-title" title={store.get().path ?? ''}>""", """        <span className="tt-grow" />
        <label className="tt-workspace" title="Workspace: panel sizes and tabs for the job at hand">
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
        </label>
        <span className="tt-title" title={store.get().path ?? ''}>""")

# Left tabs: History.
s = s.replace("""            <button className={side === 'project' ? 'on' : ''} onClick={() => setSide('project')}>
              <Upload size={13} /> Project
            </button>
          </div>
          {side === 'library' ? (
            <LibraryPanel store={store} host={host} env={env} onOpen={(p, id) => open(p, id)} />
          ) : (
            <ProjectPanel store={store} host={host} />
          )}
        </aside>""", """            <button className={side === 'project' ? 'on' : ''} onClick={() => setSide('project')}>
              <Upload size={13} /> Project
            </button>
            <button className={side === 'history' ? 'on' : ''} onClick={() => setSide('history')}>
              <HistoryIcon size={13} /> History
            </button>
          </div>
          {side === 'library' && (
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
              <LibraryPanel store={store} host={host} env={env} onOpen={(p, id) => open(p, id)} />
            </>
          )}
          {side === 'project' && <ProjectPanel store={store} host={host} />}
          {side === 'history' && <HistoryPanel store={store} />}
          <Splitter axis="x" edge="right" value={layout.left} onChange={(left) => setLayout({ left: clampSize('left', left) })} label="Resize the left panel" />
        </aside>""")

# Canvas-only button in the view bar.
s = s.replace("""            <select className="tt-select" aria-label="Zoom" value={zoom}""", """            <button
              className={`tt-plain tt-canvas-btn${layout.canvasOnly ? ' on' : ''}`}
              onClick={() => setLayout((l) => ({ canvasOnly: !l.canvasOnly }))}
              title="The canvas on its own (`)"
              aria-pressed={layout.canvasOnly}
              aria-label="Canvas only"
            >
              {layout.canvasOnly ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <select className="tt-select" aria-label="Zoom" value={zoom}""")

s = s.replace("""        <aside className="tt-right">""", """        <aside className="tt-right">
          <Splitter axis="x" edge="left" value={layout.right} onChange={(r) => setLayout({ right: clampSize('right', r) })} label="Resize the right panel" />""")

s = s.replace("""      <Timeline store={store} ram={ram} />""", """      <div className="tt-timeline-wrap">
        <Splitter axis="y" edge="top" value={layout.timeline} onChange={(t) => setLayout({ timeline: clampSize('timeline', t) })} label="Resize the timeline" />
        <Timeline store={store} ram={ram} />
      </div>""")

s = s.replace("""import { Mark } from './Mark';""", """import { Mark } from './Mark';
import { HistoryPanel } from './HistoryPanel';
import { saveVersion } from './versions';
import { Splitter } from './Splitter';
import {
  clampSize,
  forgetTitle,
  loadLayout,
  recentTitles,
  rememberTitle,
  saveLayout,
  workspace,
  WORKSPACE_NAMES,
  type Layout,
  type LeftTab,
  type RightTab,
  type WorkspaceName,
} from './workspace';""")
s = s.replace("""  Plus,
} from 'lucide-react';""", """  Plus,
  History as HistoryIcon,
  Maximize2,
  Minimize2,
} from 'lucide-react';""")
open(p, 'w').write(s)
print('ok')
