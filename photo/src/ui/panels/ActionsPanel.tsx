// Actions: play, record and edit recorded command lists.

import { useEffect, useState } from 'react';
import { Play, Square, Circle, Plus, Trash2, ChevronRight, ChevronDown } from 'lucide-react';
import { getActions, onActions, play, record, stop, recordingAction, setActions } from '../../app/actions';
import { openDialog } from '../../app/state';

export function ActionsPanel() {
  const [, setTick] = useState(0);
  useEffect(() => onActions(() => setTick((t) => t + 1)), []);
  const list = getActions();
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const rec = recordingAction();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {list.map((a, i) => (
          <div key={i}>
            <div className={`lp-row${sel === i ? ' lp-sel' : ''}`} onClick={() => setSel(i)} onDoubleClick={() => void play(i)}>
              <button
                className="lp-icon-btn"
                style={{ width: 18, height: 18 }}
                aria-label={open.has(i) ? 'Collapse' : 'Expand'}
                onClick={(e) => {
                  e.stopPropagation();
                  const n = new Set(open);
                  if (n.has(i)) n.delete(i);
                  else n.add(i);
                  setOpen(n);
                }}
              >
                {open.has(i) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              <span className="lp-grow">{a.name}</span>
              {rec === i && <Circle size={10} fill="var(--danger)" color="var(--danger)" />}
            </div>
            {open.has(i) &&
              a.steps.map((st, j) => (
                <div key={j} className="lp-row" style={{ paddingLeft: 30, minHeight: 26 }}>
                  <input
                    type="checkbox"
                    checked={st.enabled}
                    aria-label={`Use ${st.label}`}
                    onChange={() => {
                      const n = structuredClone(list);
                      n[i]!.steps[j]!.enabled = !st.enabled;
                      setActions(n);
                    }}
                  />
                  <span className="lp-grow" onDoubleClick={() => void play(i, j)}>
                    {st.label}
                  </span>
                  <button
                    className="lp-icon-btn"
                    style={{ width: 18, height: 18 }}
                    aria-label="Delete step"
                    onClick={() => {
                      const n = structuredClone(list);
                      n[i]!.steps.splice(j, 1);
                      setActions(n);
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
          </div>
        ))}
        {!list.length && <div className="lp-empty">No actions yet.</div>}
      </div>
      <div className="lp-panel-foot">
        <span className="lp-faint" style={{ marginRight: 'auto' }}>
          {rec !== null ? 'Recording…' : ''}
        </span>
        <button className="lp-icon-btn" title="Stop" aria-label="Stop recording" disabled={rec === null} onClick={() => stop()}>
          <Square size={13} />
        </button>
        <button className="lp-icon-btn" title="Record" aria-label="Record" disabled={rec !== null || !list[sel]} onClick={() => record(sel)}>
          <Circle size={13} />
        </button>
        <button className="lp-icon-btn" title="Play" aria-label="Play" disabled={!list[sel] || rec !== null} onClick={() => void play(sel)}>
          <Play size={13} />
        </button>
        <button
          className="lp-icon-btn"
          title="New action"
          aria-label="New action"
          onClick={() =>
            openDialog('prompt', {
              title: 'New Action',
              value: `Action ${list.length + 1}`,
              ok: (name: string) => {
                setActions([...list, { name, steps: [] }]);
                setSel(list.length);
                record(list.length);
              },
            })
          }
        >
          <Plus size={15} />
        </button>
        <button
          className="lp-icon-btn"
          title="Delete action"
          aria-label="Delete action"
          disabled={!list[sel]}
          onClick={() => {
            setActions(list.filter((_, i) => i !== sel));
            setSel(0);
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
