import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/designer/Designer.tsx'
rep(p,"""  const store = useMemo(() => new Store(initial ?? newProject(), { brand, values }), []); // eslint-disable-line react-hooks/exhaustive-deps""","""  // Titles open in tabs: each its own store (undo, selection, playhead).
  const [tabs, setTabs] = useState<Store[]>(() => [new Store(initial ?? newProject(), { brand, values })]);
  const [active, setActive] = useState(0);
  const store = tabs[Math.min(active, tabs.length - 1)]!;
  const libIds = useRef(new WeakMap<Store, string | null>());
  const libId = libIds.current.get(store) ?? null;
  const setLibId = (id: string | null) => libIds.current.set(store, id);""")
rep(p,"""  const [libId, setLibId] = useState<string | null>(null);\n""","")
rep(p,"""  const open = (p: TitleProject, id?: string | null, path?: string | null) => {
    if (store.get().dirty && !confirm('Open another title? Changes to this one that are not saved will be lost.')) return;
    store.load(p, { path: path ?? null });
    setLibId(id ?? null);""","""  const open = (p: TitleProject, id?: string | null, path?: string | null) => {
    // The same title already open: go to its tab.
    const again = tabs.findIndex((t) => (id && libIds.current.get(t) === id) || (path && t.get().path === path));
    if (again >= 0) {
      setActive(again);
      setSide('project');
      return;
    }
    // An untouched new title is replaced; otherwise the title opens in a tab of its own.
    const s = store.get();
    const blank = !s.dirty && !s.path && !libIds.current.get(store) && store.canUndo() === false && s.project.compositions.every((c) => !c.layers.length);
    const target = blank ? store : new Store(p, { brand, values });
    if (blank) store.load(p, { path: path ?? null });
    else {
      target.set({ path: path ?? null });
      setTabs((list) => [...list, target]);
      setActive(tabs.length);
    }
    libIds.current.set(target, id ?? null);""")
rep(p,"""          <span className="tt-title" title={store.get().path ?? ''}>
            {project.name}
            {dirty ? ' •' : ''}
          </span>""","""          {tabs.length === 1 && (
            <span className="tt-title" title={store.get().path ?? ''}>
              {project.name}
              {dirty ? ' •' : ''}
            </span>
          )}""")
rep(p,"""        <div className="tt-main">""","""        {tabs.length > 1 && <TitleTabs tabs={tabs} active={Math.min(active, tabs.length - 1)} onPick={setActive} onClose={closeTab} />}
        <div className="tt-main" key={tabKey(store)}>""")
rep(p,"""  const importFile = async () => {""","""  const closeTab = (i: number) => {
    const t = tabs[i];
    if (!t) return;
    if (t.get().dirty && !confirm(`Close “${t.get().project.name}”? Changes that are not saved will be lost.`)) return;
    const next = tabs.filter((_, j) => j !== i);
    setTabs(next.length ? next : [new Store(newProject(), { brand, values })]);
    setActive((a) => Math.max(0, Math.min(next.length - 1, a > i ? a - 1 : a === i ? i - 1 : a)));
  };

  const importFile = async () => {""")
s=open(p).read()
s+='''
const tabIds = new WeakMap<Store, number>();
let tabSeq = 0;
function tabKey(s: Store): number {
  let k = tabIds.get(s);
  if (k === undefined) tabIds.set(s, (k = ++tabSeq));
  return k;
}

/** The open titles, one tab each (shown when more than one is open). */
function TitleTabs({ tabs, active, onPick, onClose }: { tabs: Store[]; active: number; onPick: (i: number) => void; onClose: (i: number) => void }) {
  return (
    <div className="tt-doc-tabs" role="tablist" aria-label="Open titles">
      {tabs.map((t, i) => (
        <TitleTab key={tabKey(t)} store={t} on={i === active} onPick={() => onPick(i)} onClose={() => onClose(i)} />
      ))}
    </div>
  );
}

function TitleTab({ store, on, onPick, onClose }: { store: Store; on: boolean; onPick: () => void; onClose: () => void }) {
  const name = useStore(store, (s) => s.project.name);
  const dirty = useStore(store, (s) => s.dirty);
  return (
    <div className={`tt-doc-tab${on ? ' on' : ''}`} role="tab" aria-selected={on} title={store.get().path ?? name}>
      <button className="tt-doc-tab-name" onClick={onPick} onAuxClick={(e) => e.button === 1 && onClose()}>
        {name || 'Untitled'}
        {dirty && <span className="tt-doc-dirty" aria-label="not saved" />}
      </button>
      <button className="tt-doc-tab-close" onClick={onClose} aria-label={`Close ${name}`}>
        ×
      </button>
    </div>
  );
}
'''
open(p,'w').write(s)
c=open('titler/src/designer/designer.css').read()
c+='''
/* ---- open titles (tabs) ---- */
.tt-doc-tabs {
  grid-area: tabs;
  display: flex;
  gap: 1px;
  background: var(--tt-bar);
  border-bottom: 1px solid var(--tt-line);
  overflow-x: auto;
  scrollbar-width: thin;
}
.tt-doc-tab {
  display: flex;
  align-items: center;
  max-width: 220px;
  border-right: 1px solid var(--tt-line);
  color: var(--tt-dim);
}
.tt-doc-tab.on {
  background: var(--tt-panel);
  color: var(--tt-text);
}
.tt-doc-tab-name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 5px 4px 5px 12px;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.tt-doc-dirty {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}
.tt-doc-tab-close {
  background: none;
  border: 0;
  color: var(--tt-faint);
  padding: 2px 8px;
  font-size: 14px;
  cursor: pointer;
}
.tt-doc-tab-close:hover {
  color: var(--tt-text);
}
'''
open('titler/src/designer/designer.css','w').write(c)
