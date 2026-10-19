// Channels: the color channels (for reference) and the saved selections
// (alpha channels): show one, load it as a selection, save, delete.

import { useState } from 'react';
import { Eye, EyeOff, Plus, Trash2, CircleDashed, Save } from 'lucide-react';
import { current, useApp, bump, requestFrame } from '../../app/state';
import * as sel from '../../app/ops/select';
import { rasterThumb } from './LayersPanel';
import { Raster } from '../../core/raster';
import { uid } from '../../core/layers';

export function ChannelsPanel() {
  useApp((s) => s.rev);
  const s = current();
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!s) return <div className="lp-empty">No document</div>;
  const doc = s.doc;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {['RGB', 'Red', 'Green', 'Blue'].map((n, i) => (
          <div key={n} className="lp-row" style={{ color: i ? 'var(--dim)' : undefined }}>
            <Eye size={14} style={{ color: 'var(--faint)' }} />
            <span className="lp-grow">{n}</span>
          </div>
        ))}
        {doc.channels.map((c) => (
          <div
            key={c.id}
            className={`lp-row${s.showMask === c.id ? ' lp-sel' : ''}`}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) {
                sel.loadSelection(c.id, e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace');
                return;
              }
              s.showMask = s.showMask === c.id ? null : c.id;
              s.compositor?.invalidate();
              bump();
            }}
            title="Click to view alone, Ctrl+click to load as a selection"
          >
            <button
              className="lp-icon-btn"
              style={{ width: 20, height: 20 }}
              aria-label={s.showMask === c.id ? 'Hide channel' : 'Show channel'}
              onClick={(e) => {
                e.stopPropagation();
                s.showMask = s.showMask === c.id ? null : c.id;
                requestFrame();
                bump();
              }}
            >
              {s.showMask === c.id ? <Eye size={14} /> : <EyeOff size={14} style={{ opacity: 0.5 }} />}
            </button>
            <span className="lp-thumb" style={{ width: 28, height: 28, display: 'flex' }}>
              <img src={rasterThumb(c.raster, doc, 56, true)} alt="" style={{ maxWidth: '100%', maxHeight: '100%' }} />
            </span>
            <span className="lp-grow" onDoubleClick={() => setRenaming(c.id)}>
              {renaming === c.id ? (
                <input
                  className="lp-input"
                  autoFocus
                  defaultValue={c.name}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v) {
                      s.commit('Rename Channel', 'channel', { ...s.doc, channels: s.doc.channels.map((x) => (x.id === c.id ? { ...x, name: v } : x)) });
                      bump();
                    }
                    setRenaming(null);
                  }}
                />
              ) : (
                c.name
              )}
            </span>
          </div>
        ))}
        {!doc.channels.length && <div className="lp-empty">Saved selections appear here (Select ▸ Save Selection).</div>}
      </div>
      <div className="lp-panel-foot">
        <button
          className="lp-icon-btn"
          title="Load channel as selection"
          aria-label="Load channel as selection"
          disabled={!s.showMask || !doc.channels.some((c) => c.id === s.showMask)}
          onClick={() => s.showMask && sel.loadSelection(s.showMask)}
        >
          <CircleDashed size={15} />
        </button>
        <button
          className="lp-icon-btn"
          title="Save selection as channel"
          aria-label="Save selection as channel"
          disabled={!doc.selection}
          onClick={() => sel.saveSelection()}
        >
          <Save size={15} />
        </button>
        <button
          className="lp-icon-btn"
          title="New channel"
          aria-label="New channel"
          onClick={() => {
            const ch = {
              id: uid('ch'),
              name: `Alpha ${doc.channels.length + 1}`,
              raster: new Raster(8, 1),
              visible: false,
              color: [1, 0, 0, 0.5] as [number, number, number, number],
            };
            s.commit('New Channel', 'channel', { ...s.doc, channels: [...s.doc.channels, ch] });
            bump();
          }}
        >
          <Plus size={16} />
        </button>
        <button
          className="lp-icon-btn"
          title="Delete channel"
          aria-label="Delete channel"
          disabled={!doc.channels.some((c) => c.id === s.showMask)}
          onClick={() => s.showMask && sel.deleteChannel(s.showMask)}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}
