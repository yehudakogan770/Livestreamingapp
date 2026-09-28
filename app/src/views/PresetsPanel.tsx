import { useCallback, useState } from 'react';
import { useCommands, type Command } from './commands';
import type { EngineClient } from '../engine/client';
import type { Preset } from '../engine/types/Preset';
import type { Show } from '../engine/types/Show';
import { PresetEditor } from './PresetEditor';
import type { Act } from './act';

/** The event's presets in running order: click to pick, ◀ ▶ to run the show. */
export function PresetsPanel({ show, client, act }: { show: Show; client: EngineClient; act: Act }) {
  const [editing, setEditing] = useState<Preset | 'new' | null>(null);
  useCommands(useCallback((c: Command) => c.type === 'addPreset' && setEditing('new'), []));
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const list = show.presets.map((p, i) => ({ p, n: i + 1 })).filter(({ p }) => !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  return (
    <aside className="presets" aria-label="Presets">
      <div className="presets__head">
        <span className="presets__title">Presets</span>
        <button type="button" className="chip" onClick={() => setEditing('new')}>
          + Add
        </button>
      </div>
      {show.presets.length > 4 && (
        <input className="text presets__search" value={search} placeholder="Search…" aria-label="Search presets" onChange={(e) => setSearch(e.target.value)} />
      )}
      <ol className="presets__list">
        {show.presets.length === 0 && (
          <li className="presets__empty">
            A preset is a part of the event (Opening, Speaker, Video…): its inputs, transition and buttons. Add one to run the show in order.
          </li>
        )}
        {list.map(({ p, n }) => {
          const on = show.activePreset === p.id;
          return (
            <li key={p.id} className={`presets__item${on ? ' is-on' : ''}`}>
              <button type="button" className="presets__pick" aria-pressed={on} onClick={() => act({ type: 'pickPreset', id: on ? undefined : p.id })}>
                <span className="presets__n">{n}</span>
                <span className="presets__name">
                  {p.name}
                  {p.category && <small>{p.category}</small>}
                </span>
                <span className="presets__count" title="Inputs in this preset">
                  {p.sources.length || ''}
                </span>
              </button>
              <button type="button" className="presets__edit" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                ✎
              </button>
            </li>
          );
        })}
      </ol>
      <div className="presets__nav">
        <button type="button" className="btn" disabled={!show.presets.length} onClick={() => act({ type: 'previousPreset' })}>
          ◀ Prev
        </button>
        <button type="button" className="btn" disabled={!show.presets.length} onClick={() => act({ type: 'nextPreset' })}>
          Next ▶
        </button>
      </div>
      {editing && <PresetEditor show={show} client={client} act={act} preset={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </aside>
  );
}
