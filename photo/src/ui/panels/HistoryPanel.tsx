// History: every step (click one to go back to it; later steps stay until
// something new is done), snapshots, and the History Brush's source.

import { useEffect, useRef } from 'react';
import { Camera, History as HistoryIcon, Trash2 } from 'lucide-react';
import { current, useApp, bump } from '../../app/state';
import { goToStep } from '../../app/ops/edit';
import { historyBrushSource, setHistoryBrushSource } from '../../app/tools/paintTools';

export function HistoryPanel() {
  useApp((s) => s.rev);
  const s = current();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('.lp-current')?.scrollIntoView({ block: 'nearest' });
  });
  if (!s) return <div className="lp-empty">No document</div>;
  const h = s.history;
  const src = historyBrushSource ?? h.snapshots[0]?.id;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div ref={list} style={{ flex: 1, overflow: 'auto' }} role="listbox" aria-label="History">
        {h.snapshots.map((snap, i) => (
          <div key={snap.id} className="lp-row" role="option" aria-selected={false} onClick={() => {
            if (i === 0 && h.dropped === 0) {
              goToStep(0);
              return;
            }
            const st = h.restore(snap, { ...s.doc });
            s.restore(st);
            bump();
          }}>
            <button
              className="lp-icon-btn"
              style={{ width: 20, height: 20 }}
              title="Set the source for the History Brush"
              aria-label="History Brush source"
              aria-pressed={src === snap.id}
              onClick={(e) => {
                e.stopPropagation();
                setHistoryBrushSource(snap.id);
              }}
            >
              {src === snap.id ? <HistoryIcon size={13} /> : <span style={{ width: 13 }} />}
            </button>
            <Camera size={13} style={{ color: 'var(--dim)' }} />
            <span className="lp-grow">{snap.name}</span>
          </div>
        ))}
        <div className="lp-menu-sep" />
        <div className={`lp-row${h.index === 0 ? ' lp-sel lp-current' : ''}`} onClick={() => goToStep(0)} role="option" aria-selected={h.index === 0}>
          <span style={{ width: 20 }} />
          <span className="lp-grow">{h.dropped ? 'Earlier steps (let go)' : 'Open'}</span>
        </div>
        {h.steps.map((st, i) => {
          const n = i + 1;
          const cur = n === h.index;
          return (
            <div key={st.id} className={`lp-row${cur ? ' lp-sel lp-current' : ''}${n > h.index ? ' lp-future' : ''}`} onClick={() => goToStep(n)} role="option" aria-selected={cur}>
              <span style={{ width: 20 }} />
              <span className="lp-grow">{st.label}</span>
            </div>
          );
        })}
      </div>
      <div className="lp-panel-foot">
        <span className="lp-faint" style={{ marginRight: 'auto' }}>
          {h.steps.length} step{h.steps.length === 1 ? '' : 's'}
        </span>
        <button
          className="lp-icon-btn"
          title="New snapshot"
          aria-label="New snapshot"
          onClick={() => {
            h.snapshot({ ...s.doc });
            bump();
          }}
        >
          <Camera size={15} />
        </button>
        <button
          className="lp-icon-btn"
          title="Delete the last snapshot"
          aria-label="Delete snapshot"
          disabled={h.snapshots.length < 2}
          onClick={() => {
            const gone = h.snapshots.pop();
            if (gone && historyBrushSource === gone.id) setHistoryBrushSource(null);
            bump();
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}
