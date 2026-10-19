import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='Inspector.tsx'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''          <CopyFields store={store} l={l} compId={c.id} />
          <button className="tt-link" onClick={() => store.set({ compId: l.comp, selection: [] })}>
            Open this composition
          </button>
        </Section>
      )}''','''          <CopyFields store={store} l={l} compId={c.id} />
          <button className="tt-link" onClick={() => store.set({ compId: l.comp, selection: [] })}>
            Open this composition
          </button>
        </Section>
      )}
      {l.type === 'comp' && <CopyOverrides store={store} l={l} compId={c.id} tokens={tokens} vals={vals} fieldKeys={fieldKeys} />}''')
rep('''/** Character styles: the selected words''','''/**
 * This copy's own changes to the layers inside the composition it shows (a
 * component's overrides): pick a layer, then change its words, color,
 * picture, visibility, place, size, turn or opacity for this copy only.
 */
function CopyOverrides({
  store,
  l,
  compId,
  tokens,
  vals,
  fieldKeys,
}: {
  store: Store;
  l: CompLayer;
  compId: string;
  tokens: ReturnType<typeof tokensFor>;
  vals: Record<string, string>;
  fieldKeys: string[];
}) {
  const project = useStore(store, (s) => s.project);
  const inner = project.compositions.find((x) => x.id === l.comp);
  const list = inner ? flatLayers(inner.layers).filter((x) => x.type !== 'null' && x.type !== 'group') : [];
  const changed = list.filter((x) => overrides(l.overrides?.[x.id]));
  const [pick, setPick] = useState<string>('');
  const target = list.find((x) => x.id === pick) ?? changed[0] ?? list[0];
  if (!inner || !target) return null;
  const o: LayerOverride = l.overrides?.[target.id] ?? {};
  const set = (label: string, patch: Partial<LayerOverride> | null) =>
    store.edit(label, (p) =>
      updateLayers(p, compId, [l.id], (x) => {
        if (x.type !== 'comp') return x;
        const all = { ...(x.overrides ?? {}) };
        const next: LayerOverride = patch ? { ...(all[target.id] ?? {}), ...patch } : {};
        for (const k of Object.keys(next) as (keyof LayerOverride)[]) if (next[k] === undefined) delete next[k];
        if (overrides(next)) all[target.id] = next;
        else delete all[target.id];
        return { ...x, overrides: Object.keys(all).length ? all : undefined };
      }),
    );
  const fillOf = (x: Layer) => (x.type === 'text' && x.style.fill.type === 'solid' ? x.style.fill.color : x.type === 'shape' && x.fill?.type === 'solid' ? x.fill.color : null);
  const baseFill = fillOf(target);
  return (
    <Section title="This copy's changes" open={changed.length > 0}>
      <div className="tt-dim tt-small">Change a layer inside for this copy only; the composition and its other copies stay as they are.</div>
      <Row label="Layer">
        <select className="tt-select" aria-label="Layer to change in this copy" value={target.id} onChange={(e) => setPick(e.target.value)}>
          {list.map((x) => (
            <option key={x.id} value={x.id}>
              {overrides(l.overrides?.[x.id]) ? '• ' : ''}
              {x.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Shown">
        <Toggle value={o.visible ?? target.visible} label="Shown in this copy" onChange={(v) => set('Show in this copy', { visible: v === target.visible ? undefined : v })} />
      </Row>
      {target.type === 'text' && (
        <Row label="Words">
          <textarea
            className="tt-textarea"
            rows={2}
            aria-label="Words in this copy"
            placeholder={target.text}
            value={o.text ?? ''}
            onChange={(e) => set('Words in this copy', { text: e.target.value === '' ? undefined : e.target.value })}
          />
        </Row>
      )}
      {baseFill !== null && (
        <Row label="Color">
          <ColorField
            value={o.fill ?? baseFill}
            label="Color in this copy"
            tokens={tokens}
            values={vals}
            fields={fieldKeys}
            onChange={(v) => set('Color in this copy', { fill: v === baseFill ? undefined : v })}
          />
        </Row>
      )}
      {target.type === 'image' && (
        <Row label="Picture">
          <select
            className="tt-select"
            aria-label="Picture in this copy"
            value={o.picture ?? target.asset}
            onChange={(e) => set('Picture in this copy', { picture: e.target.value === target.asset ? undefined : e.target.value })}
          >
            {project.assets
              .filter((a) => a.kind === 'image' || a.kind === 'svg')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            {!project.assets.some((a) => a.id === target.asset) && <option value={target.asset}>{target.asset.startsWith('{{') ? target.asset : 'Its own'}</option>}
          </select>
        </Row>
      )}
      <Row label="Move by">
        <NumberField value={o.move?.[0] ?? 0} label="Move across in this copy" unit="px" onChange={(v) => set('Move in this copy', { move: [v, o.move?.[1] ?? 0] })} />
        <NumberField value={o.move?.[1] ?? 0} label="Move down in this copy" unit="px" onChange={(v) => set('Move in this copy', { move: [o.move?.[0] ?? 0, v] })} />
      </Row>
      <Row label="Scale">
        <NumberField value={o.scale ?? 100} min={0} label="Scale in this copy" unit="%" onChange={(v) => set('Scale in this copy', { scale: v === 100 ? undefined : v })} />
      </Row>
      <Row label="Rotation">
        <NumberField value={o.rotate ?? 0} label="Rotation in this copy" unit="°" onChange={(v) => set('Turn in this copy', { rotate: v || undefined })} />
      </Row>
      <Row label="Opacity">
        <NumberField
          value={o.opacity ?? 100}
          min={0}
          max={100}
          label="Opacity in this copy"
          unit="%"
          onChange={(v) => set('Opacity in this copy', { opacity: v === 100 ? undefined : v })}
        />
      </Row>
      {overrides(o) && (
        <button className="tt-link" onClick={() => set(`Reset ${target.name} in this copy`, null)}>
          Reset {target.name} in this copy
        </button>
      )}
    </Section>
  );
}

/** Character styles: the selected words''')
rep('''import type {
  CompLayer,''','''import { overrides } from '../core/components';
import type {
  LayerOverride,
  CompLayer,''')
open(p,'w').write(s)
