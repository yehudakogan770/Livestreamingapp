// Layer Comps: saved states of which layers show, where they sit and their
// effects; click one to apply it.

import { useState } from 'react';
import { Plus, Trash2, RefreshCw, Check } from 'lucide-react';
import { current, useApp, bump, openDialog } from '../../app/state';
import { allLayers, updateLayer, uid } from '../../core/layers';
import { shiftedLayer } from '../../app/tools/transform';
import { layerBounds } from '../../core/layers';
import type { Doc, LayerComp, LayerCompState } from '../../core/types';

function capture(doc: Doc): Record<string, LayerCompState> {
  const out: Record<string, LayerCompState> = {};
  for (const l of allLayers(doc.layers)) {
    const b = layerBounds(l, doc);
    out[l.id] = { visible: l.visible, x: b?.x, y: b?.y, styles: l.styles };
  }
  return out;
}

function applyComp(c: LayerComp): void {
  const s = current();
  if (!s) return;
  let layers = s.doc.layers;
  for (const l of allLayers(s.doc.layers)) {
    const st = c.layers[l.id];
    if (!st) continue;
    let next = { ...l, visible: st.visible, styles: st.styles };
    const b = layerBounds(l, s.doc);
    if (b && st.x !== undefined && st.y !== undefined && (b.x !== st.x || b.y !== st.y) && l.kind !== 'group') next = { ...shiftedLayer(next, st.x - b.x, st.y - b.y) };
    layers = updateLayer(layers, l.id, () => next);
  }
  s.commit(`Apply Layer Comp: ${c.name}`, 'comp', { ...s.doc, layers });
  bump();
}

export function CompsPanel() {
  useApp((s) => s.rev);
  const s = current();
  const [sel, setSel] = useState<string | null>(null);
  if (!s) return <div className="lp-empty">No document</div>;
  const comps = s.doc.comps;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {comps.map((c) => (
          <div key={c.id} className={`lp-row${sel === c.id ? ' lp-sel' : ''}`} onClick={() => {
            setSel(c.id);
            applyComp(c);
          }} title={c.comment || undefined}>
            <span style={{ width: 14 }}>{sel === c.id ? <Check size={12} /> : null}</span>
            <span className="lp-grow">{c.name}</span>
          </div>
        ))}
        {!comps.length && <div className="lp-empty">Save versions of the layout (which layers show, where they are) and switch between them.</div>}
      </div>
      <div className="lp-panel-foot">
        <button
          className="lp-icon-btn"
          title="Update the selected comp with the current layers"
          aria-label="Update layer comp"
          disabled={!sel}
          onClick={() => {
            s.commit('Update Layer Comp', 'comp', { ...s.doc, comps: comps.map((c) => (c.id === sel ? { ...c, layers: capture(s.doc) } : c)) });
            bump();
          }}
        >
          <RefreshCw size={14} />
        </button>
        <button
          className="lp-icon-btn"
          title="New layer comp"
          aria-label="New layer comp"
          onClick={() =>
            openDialog('prompt', {
              title: 'New Layer Comp',
              value: `Layer Comp ${comps.length + 1}`,
              ok: (name: string) => {
                const c: LayerComp = { id: uid('lc'), name, comment: '', layers: capture(s.doc) };
                s.commit('New Layer Comp', 'comp', { ...s.doc, comps: [...s.doc.comps, c] });
                setSel(c.id);
                bump();
              },
            })
          }
        >
          <Plus size={15} />
        </button>
        <button
          className="lp-icon-btn"
          title="Delete layer comp"
          aria-label="Delete layer comp"
          disabled={!sel}
          onClick={() => {
            s.commit('Delete Layer Comp', 'comp', { ...s.doc, comps: comps.filter((c) => c.id !== sel) });
            setSel(null);
            bump();
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
