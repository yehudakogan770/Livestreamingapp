import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

edit('titler/src/designer/Panels.tsx', [
("""          exports, and in this preview and its films.
        </div>
      </Section>
    </div>
  );""", """          exports, and in this preview and its films.
        </div>
      </Section>
      <FormatsSection store={store} />
    </div>
  );"""),
("""export function CompositionPanel({ store }: { store: Store }) {""", """/** The title in other shapes (9:16 for vertical streams, 1:1, 4K): made from the main composition by the layers' constraints. */
function FormatsSection({ store }: { store: Store }) {
  const project = useStore(store, (s) => s.project);
  const compId = useStore(store, (s) => s.compId);
  const list = formatsOf(project);
  const main = list[0];
  if (!main) return null;
  const current = list.find((c) => c.id === compId);
  const has = (w: number, h: number) => list.some((c) => c.width === w && c.height === h);
  return (
    <Section title="Formats" open={list.length > 1}>
      <div className="tt-dim tt-small">
        The title in other shapes. On air, Lumora and Studio use the one closest to the picture&rsquo;s shape (a vertical stream gets the 9:16 one).
      </div>
      <ul className="tt-formats">
        {list.map((c) => (
          <li key={c.id} className={c.id === compId ? 'on' : ''}>
            <button onClick={() => store.set({ compId: c.id, selection: [] })} title="Open this format">
              {c.id === main.id ? `${c.name} (main)` : c.name}
            </button>
            <span className="tt-dim">
              {c.width} × {c.height}
            </span>
            {c.id !== main.id && (
              <button
                className="tt-link"
                title="Make it again from the main composition (changes made in this format are lost)"
                onClick={() => {
                  if (!confirm(`Make “${c.name}” again from the main composition? Changes made in it are lost.`)) return;
                  store.edit('Remake format', (p) => makeFormat(p, '', c.width, c.height, c.id).project);
                }}
              >
                Remake
              </button>
            )}
          </li>
        ))}
      </ul>
      <Row label="Add">
        <select
          className="tt-select"
          aria-label="Add a format"
          value=""
          onChange={(e) => {
            const f = FORMAT_PRESETS.find((x) => x.name === e.target.value);
            if (!f) return;
            const r = makeFormat(store.get().project, f.name, f.w, f.h);
            store.edit(`Add ${f.name} format`, () => r.project, { compId: r.id, selection: [] });
          }}
        >
          <option value="">Make a format…</option>
          {FORMAT_PRESETS.filter((f) => !has(f.w, f.h)).map((f) => (
            <option key={f.name} value={f.name}>
              {f.name} ({f.w} × {f.h})
            </option>
          ))}
        </select>
      </Row>
      {current && current.id !== main.id && (
        <div className="tt-dim tt-small">This format was made from the main composition; change it here as you like. Its layers keep their names, fields and timing.</div>
      )}
    </Section>
  );
}

export function CompositionPanel({ store }: { store: Store }) {"""),
("import { cleanMarkers } from '../core/timeline';", "import { cleanMarkers } from '../core/timeline';\nimport { FORMAT_PRESETS, formatsOf, makeFormat } from '../core/formats';"),
])

edit('titler/src/designer/Inspector.tsx', [
("""        <Row label="Blend">
          <Select
            label="Blend mode\"""", """        <Row label="Constraints" hint="How the layer is placed in the title's other formats (9:16, 1:1, 4K): pinned, scaled or stretched">
          <Select
            label="Constraint across"
            value={l.constraints?.h ?? 'auto'}
            options={[
              ['auto', 'Auto'],
              ['left', 'Left'],
              ['center', 'Center'],
              ['right', 'Right'],
              ['scale', 'Scale'],
              ['stretch', 'Left and right'],
            ]}
            onChange={(h) => upd('Constraints', (x) => ({ ...x, constraints: { ...x.constraints, h: h === 'auto' ? undefined : h } }))}
          />
          <Select
            label="Constraint down"
            value={l.constraints?.v ?? 'auto'}
            options={[
              ['auto', 'Auto'],
              ['top', 'Top'],
              ['center', 'Center'],
              ['bottom', 'Bottom'],
              ['scale', 'Scale'],
              ['stretch', 'Top and bottom'],
            ]}
            onChange={(v) => upd('Constraints', (x) => ({ ...x, constraints: { ...x.constraints, v: v === 'auto' ? undefined : v } }))}
          />
        </Row>
        <Row label="Blend">
          <Select
            label="Blend mode\""""),
])
s = open('titler/src/designer/designer.css').read()
s += '''
/* Formats of the title. */
.tt-formats {
  list-style: none;
  margin: 4px 0 6px;
  padding: 0;
}
.tt-formats li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}
.tt-formats li > button:first-child {
  flex: 1;
  min-width: 0;
  text-align: left;
  padding: 3px 6px;
  border-radius: var(--tt-radius);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tt-formats li.on > button:first-child {
  background: var(--tt-selected);
}
'''
open('titler/src/designer/designer.css', 'w').write(s)
print('ok')
