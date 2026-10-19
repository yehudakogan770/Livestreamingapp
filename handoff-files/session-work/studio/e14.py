root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/app/src/ui/Editor.tsx', [
("  Palette,\n","  Palette,\n  Workflow,\n"),
("""const mixerPage = () => import('./Mixer');""","""const mixerPage = () => import('./Mixer');
const compositePage = () => import('./CompositePage');
const CompositeGraph = lazy(() => compositePage().then((m) => ({ default: m.CompositeGraph })));
const NodeInspector = lazy(() => compositePage().then((m) => ({ default: m.NodeInspector })));"""),
("""void Promise.all([colorPage(), mixerPage()])""","""void Promise.all([colorPage(), mixerPage(), compositePage()])"""),
("""        { label: 'Color page', keys: 'Shift+2', checked: u.page === 'color', run: () => ui.set({ page: 'color' }) },""","""        { label: 'Composite page', keys: 'Shift+4', checked: u.page === 'composite', run: () => ui.set({ page: 'composite' }) },
        { label: 'Color page', keys: 'Shift+2', checked: u.page === 'color', run: () => ui.set({ page: 'color' }) },"""),
("""      {u.page === 'color' && (
        <div className="page page--color">""","""      {u.page === 'composite' && (
        <div className="page page--composite">
          <div className="page__top">
            <ProgramMonitor doc={doc} engine={engine} ui={ui} actions={actions} />
            <Suspense fallback={null}>
              <NodeInspector doc={doc} engine={engine} actions={actions} ui={ui} />
            </Suspense>
          </div>
          <Splitter ui={ui} which="bottom" />
          <div className="page__bottom">
            <Suspense fallback={null}>
              <CompositeGraph doc={doc} engine={engine} actions={actions} ui={ui} />
            </Suspense>
          </div>
        </div>
      )}
      {u.page === 'color' && (
        <div className="page page--color">"""),
("""              ['color', 'Color', Palette, 'Grade the picture: wheels, curves, nodes and scopes', 'pageColor'],""","""              ['composite', 'Composite', Workflow, 'Build a clip’s picture from nodes: merges, masks, keys, transforms and effects', 'pageComposite'],
              ['color', 'Color', Palette, 'Grade the picture: wheels, curves, nodes and scopes', 'pageColor'],"""),
("""  if (shift && e.code === 'Digit3') return () => ui.set({ page: 'audio' });""","""  if (shift && e.code === 'Digit3') return () => ui.set({ page: 'audio' });
  if (shift && e.code === 'Digit4') return () => ui.set({ page: 'composite' });"""),
])

edit('editor/app/src/editor.css', [
(""".page--color .page__top,
.page--audio .page__top {
  grid-template-columns: minmax(0, 1fr) minmax(320px, 40%);
}
.page--color .page__bottom,
.page--audio .page__bottom {""",""".page--color .page__top,
.page--audio .page__top {
  grid-template-columns: minmax(0, 1fr) minmax(320px, 40%);
}
.page--composite .page__top {
  grid-template-columns: minmax(0, 1fr) minmax(300px, 30%);
}
.page--color .page__bottom,
.page--composite .page__bottom,
.page--audio .page__bottom {"""),
])
