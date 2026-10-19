// Paths: the saved paths and the Work Path; fill or stroke one, load it as a
// selection, or make a path from the selection.

import { useState } from 'react';
import { Plus, Trash2, CircleDashed, Spline, PaintBucket, Brush } from 'lucide-react';
import { current, useApp, bump, app } from '../../app/state';
import { setPathTarget, pathTarget } from '../../app/tools/vectorTools';
import * as sel from '../../app/ops/select';
import { pathMask, maskOutline, simplify } from '../../core/selection';
import { smoothPath } from '../../core/path';
import { uid } from '../../core/layers';
import { selectionMask } from '../../app/ops/common';
import { fillPath, strokePath } from '../../app/ops/paths';

export function PathsPanel() {
  useApp((s) => s.rev);
  const s = current();
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!s) return <div className="lp-empty">No document</div>;
  const t = pathTarget();
  const activeId = t?.kind === 'path' ? t.id : null;
  const activePath = s.doc.paths.find((p) => p.id === activeId) ?? null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {s.doc.paths.map((p) => (
          <div key={p.id} className={`lp-row${p.id === activeId ? ' lp-sel' : ''}`} onClick={(e) => {
            if (e.ctrlKey || e.metaKey) {
              sel.applySelection(pathMask(s.doc.width, s.doc.height, p.path), 'replace', 'Load Path as Selection');
              return;
            }
            setPathTarget(p.id === activeId ? null : { kind: 'path', id: p.id });
          }}>
            <Spline size={14} style={{ color: 'var(--dim)' }} />
            <span className="lp-grow" style={{ fontStyle: p.name === 'Work Path' ? 'italic' : undefined }} onDoubleClick={() => setRenaming(p.id)}>
              {renaming === p.id ? (
                <input
                  className="lp-input"
                  autoFocus
                  defaultValue={p.name === 'Work Path' ? 'Path 1' : p.name}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v) {
                      s.commit('Rename Path', 'path', { ...s.doc, paths: s.doc.paths.map((x) => (x.id === p.id ? { ...x, name: v } : x)) });
                      bump();
                    }
                    setRenaming(null);
                  }}
                />
              ) : (
                p.name
              )}
            </span>
          </div>
        ))}
        {!s.doc.paths.length && <div className="lp-empty">Paths drawn with the Pen tool appear here.</div>}
      </div>
      <div className="lp-panel-foot">
        <button className="lp-icon-btn" title="Fill path with foreground color" aria-label="Fill path" disabled={!activePath} onClick={() => activePath && fillPath(activePath.path, app.get().fg)}>
          <PaintBucket size={15} />
        </button>
        <button className="lp-icon-btn" title="Stroke path with brush" aria-label="Stroke path" disabled={!activePath} onClick={() => activePath && strokePath(activePath.path)}>
          <Brush size={15} />
        </button>
        <button className="lp-icon-btn" title="Load path as a selection" aria-label="Load path as a selection" disabled={!activePath} onClick={() => activePath && sel.applySelection(pathMask(s.doc.width, s.doc.height, activePath.path), 'replace', 'Load Path as Selection')}>
          <CircleDashed size={15} />
        </button>
        <button
          className="lp-icon-btn"
          title="Make work path from selection"
          aria-label="Make work path from selection"
          disabled={!s.doc.selection}
          onClick={() => {
            const m = selectionMask(s.doc);
            if (!m) return;
            const outlines = maskOutline(m).map((pts) => simplify(pts, 1.5)).filter((p) => p.length >= 6);
            const subpaths = outlines.flatMap((pts) => smoothPath(pts, true).subpaths);
            const others = s.doc.paths.filter((p) => p.name !== 'Work Path');
            const wp = { id: uid('p'), name: 'Work Path', path: { subpaths } };
            s.commit('Make Work Path', 'path', { ...s.doc, paths: [...others, wp] });
            setPathTarget({ kind: 'path', id: wp.id });
          }}
        >
          <Spline size={15} />
        </button>
        <button
          className="lp-icon-btn"
          title="New path"
          aria-label="New path"
          onClick={() => {
            const p = { id: uid('p'), name: `Path ${s.doc.paths.length + 1}`, path: { subpaths: [] } };
            s.commit('New Path', 'path', { ...s.doc, paths: [...s.doc.paths, p] });
            setPathTarget({ kind: 'path', id: p.id });
          }}
        >
          <Plus size={16} />
        </button>
        <button
          className="lp-icon-btn"
          title="Delete path"
          aria-label="Delete path"
          disabled={!activePath}
          onClick={() => {
            if (!activePath) return;
            s.commit('Delete Path', 'path', { ...s.doc, paths: s.doc.paths.filter((p) => p.id !== activePath.id) });
            setPathTarget(null);
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}
