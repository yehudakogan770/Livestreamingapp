import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

edit('titler/src/designer/Designer.tsx', [
("""  const [renderOpen, setRenderOpen] = useState(false);""", """  const [renderOpen, setRenderOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);"""),
("""      if (!mod && e.key === '`') return (handled(), setLayout((l) => ({ canvasOnly: !l.canvasOnly })));""", """      if (!mod && e.key === '`') return (handled(), setLayout((l) => ({ canvasOnly: !l.canvasOnly })));
      if (!mod && e.key === '?') return (handled(), setKeysOpen((o) => !o));"""),
("""      {renderOpen && <RenderDialog store={store} host={host} env={env} onClose={() => setRenderOpen(false)} />}""", """      {renderOpen && <RenderDialog store={store} host={host} env={env} onClose={() => setRenderOpen(false)} />}
      {keysOpen && <Shortcuts onClose={() => setKeysOpen(false)} />}"""),
("""        <label className="tt-workspace" title="Workspace: panel sizes and tabs for the job at hand">""", """        <button className="tt-plain tt-keys-btn" onClick={() => setKeysOpen(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
          <Keyboard size={15} />
        </button>
        <label className="tt-workspace" title="Workspace: panel sizes and tabs for the job at hand">"""),
("""  MessageSquare,
} from 'lucide-react';""", """  MessageSquare,
  Keyboard,
} from 'lucide-react';"""),
("import { HistoryPanel } from './HistoryPanel';", "import { HistoryPanel } from './HistoryPanel';\nimport { Shortcuts } from './Shortcuts';"),
])
s = open('titler/src/designer/designer.css').read()
s += '''
/* Keyboard shortcuts sheet. */
.tt-keys-btn {
  display: inline-flex;
  align-items: center;
  padding: 3px 6px;
  margin-right: 6px;
}
.tt-shortcuts {
  width: min(860px, 92vw);
}
.tt-shortcuts header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tt-shortcuts-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 28px;
  max-height: 70vh;
  overflow: auto;
}
.tt-shortcuts h3 {
  margin: 10px 0 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--tt-dim);
}
.tt-shortcuts dl {
  margin: 0;
}
.tt-shortcuts dl div {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 8px;
  padding: 3px 0;
  border-bottom: 1px solid var(--tt-line);
}
.tt-shortcuts dd {
  margin: 0;
}
.tt-shortcuts kbd {
  font: 11px var(--tt-mono);
  color: var(--tt-text);
}
'''
open('titler/src/designer/designer.css', 'w').write(s)
print('ok')
