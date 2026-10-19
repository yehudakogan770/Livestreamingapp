import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/designer/Inspector.tsx'
rep(p,"""      {l.fill && (
        <PaintField
          paint={l.fill}
          label="Fill color"
          onChange={(fill) => upd('Fill', (x) => ({ ...x, fill }))}
          tokens={tokens}
          vals={vals}
          fieldKeys={fieldKeys}
        />
      )}""","""      {l.fill && (
        <PaintField
          paint={l.fill}
          label="Fill color"
          onChange={(fill) => upd('Fill', (x) => ({ ...x, fill }))}
          tokens={tokens}
          vals={vals}
          fieldKeys={fieldKeys}
        />
      )}
      {(l.extraFills ?? []).map((f, i) => (
        <div key={i} className="tt-subcard">
          <Row label={`Fill ${i + 2}`}>
            <span className="tt-dim tt-small tt-grow">Drawn over the fill{i ? 's' : ''} before it</span>
            <button className="tt-ico" aria-label={`Remove fill ${i + 2}`} onClick={() => upd('Remove fill', (x) => ({ ...x, extraFills: (x.extraFills ?? []).filter((_, j) => j !== i) }))}>
              <Trash2 size={13} />
            </button>
          </Row>
          <PaintField
            paint={f}
            label={`Fill ${i + 2} color`}
            onChange={(paint) => upd('Fill', (x) => ({ ...x, extraFills: (x.extraFills ?? []).map((y, j) => (j === i ? paint : y)) }))}
            tokens={tokens}
            vals={vals}
            fieldKeys={fieldKeys}
          />
        </div>
      ))}
      <Row label="">
        <button
          className="tt-link"
          title="Another fill over the first (a gradient sheen over a color)"
          onClick={() =>
            upd('Add fill', (x) => ({
              ...x,
              extraFills: [
                ...(x.extraFills ?? []),
                {
                  type: 'linear',
                  angle: 180,
                  stops: [
                    { at: 0, color: '#ffffff33' },
                    { at: 1, color: '#ffffff00' },
                  ],
                },
              ],
            }))
          }
        >
          + Another fill
        </button>
      </Row>""")
# group combine + comp overrides
rep(p,"""      {l.type === 'comp' && (
        <Section title="Composition">""","""      {l.type === 'group' && (
        <Section title="Combine shapes" open={!!l.combine}>
          <Row label="Combine" hint="The layers as one shape: the back layer is the base, the ones in front of it are joined to it">
            <Select
              label="Combine the group's layers"
              value={l.combine ?? 'none'}
              options={[
                ['none', 'Off (separate layers)'],
                ['union', 'Union (add)'],
                ['subtract', 'Subtract (cut out)'],
                ['intersect', 'Intersect (where they overlap)'],
                ['exclude', 'Exclude (where they do not)'],
              ]}
              onChange={(v) => updOne('Combine shapes', (x) => (x.type === 'group' ? { ...x, combine: v === 'none' ? null : v } : x))}
            />
          </Row>
        </Section>
      )}
      {l.type === 'comp' && (
        <Section title="Composition">""")
rep(p,"""          <button className="tt-link" onClick={() => store.set({ compId: l.comp, selection: [] })}>
            Open this composition
          </button>""","""          <CopyFields store={store} l={l} compId={c.id} />
          <button className="tt-link" onClick={() => store.set({ compId: l.comp, selection: [] })}>
            Open this composition
          </button>""")
s=open(p).read()
s+='''
/** A component's own field values (this copy of a composition with its own words, colors, pictures). */
function CopyFields({ store, l, compId }: { store: Store; l: CompLayer; compId: string }) {
  const project = useStore(store, (s) => s.project);
  const inner = project.compositions.find((x) => x.id === l.comp);
  if (!inner) return null;
  const used = new Set<string>();
  const walk = (ls: Layer[]) => {
    for (const x of ls) {
      if (x.type === 'group') walk(x.children);
      if (x.type === 'text') variablesIn(x.text).forEach((k) => used.add(k));
      if (x.type === 'image') variablesIn(x.asset).forEach((k) => used.add(k));
      if (x.type === 'shape' && x.fill?.type === 'solid') variablesIn(x.fill.color).forEach((k) => used.add(k));
    }
  };
  walk(inner.layers);
  const keys = [...used];
  if (!keys.length) return <div className="tt-dim tt-small">Fields used inside it ({'{{name}}'}) can be set for each copy here.</div>;
  const label = (k: string) => project.variables.find((v) => v.key === k)?.label ?? k;
  return (
    <div className="tt-subcard" aria-label="This copy's fields">
      <div className="tt-dim tt-small">This copy&rsquo;s fields (empty: the title&rsquo;s own; may use other fields, like {'{{guest_2}}'})</div>
      {keys.map((k) => (
        <Row key={k} label={label(k)}>
          <input
            className="tt-input"
            aria-label={`${label(k)} in this copy`}
            placeholder={project.variables.find((v) => v.key === k)?.value ?? ''}
            value={l.values?.[k] ?? ''}
            onChange={(e) =>
              store.edit('Copy field', (p) =>
                updateLayers(p, compId, [l.id], (x) => {
                  if (x.type !== 'comp') return x;
                  const values = { ...(x.values ?? {}) };
                  if (e.target.value) values[k] = e.target.value;
                  else delete values[k];
                  return { ...x, values };
                }),
              )
            }
          />
        </Row>
      ))}
    </div>
  );
}
'''
open(p,'w').write(s)
rep(p,"import type { Effect, ImageLayer,","import type { CompLayer, Effect, ImageLayer,")
