import { Layers, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import { OverlayEditor } from './OverlayEditor';
import type { Act } from './act';
import './OverlayBar.css';

/**
 * Overlay buttons 1 – 4: one click puts an overlay on air (with its
 * animation) or takes it off. An empty channel, or the pencil, opens the
 * overlay editor. Keys: Shift + 1 – 4.
 */
export function OverlayBar({ show, screen, act, client }: { show: Show; screen: ScreenId; act: Act; client: EngineClient }) {
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <div className="ovbar" aria-label="Overlays">
      <span className="ovbar__label">
        <Layers aria-hidden="true" />
        Overlays
      </span>
      {show.overlays.map((o, ch) => {
        const src = show.sources.find((s) => s.id === o.sourceId);
        const here = o.screens.includes(screen);
        return (
          <span key={ch} className={`ovbar__ch${src ? '' : ' is-empty'}`}>
            <button
              type="button"
              className={`btn ovbar__btn${o.on ? ' is-on' : ''}${o.inNext && !o.on ? ' is-next' : ''}`}
              aria-pressed={o.on}
              aria-label={src ? `Overlay ${ch + 1}: ${src.name}` : `Set up overlay ${ch + 1}`}
              title={
                src
                  ? `${o.on ? 'Take off' : 'Put on air'}: ${src.name}${here ? '' : ` (on ${o.screens.join(' + ') || 'no screen'})`} · Shift+${ch + 1}`
                  : 'Choose what this overlay shows'
              }
              onClick={() => (src ? act({ type: 'setOverlayOn', channel: ch, value: !o.on }) : setEditing(ch))}
            >
              <b>{ch + 1}</b>
              {src ? <span>{src.name}</span> : <Plus className="ovbar__plus" aria-hidden="true" />}
            </button>
            {src && (
              <button type="button" className="icon ovbar__edit" aria-label={`Edit overlay ${ch + 1}`} title="Edit" onClick={() => setEditing(ch)}>
                <Pencil aria-hidden="true" />
              </button>
            )}
          </span>
        );
      })}
      {editing !== null && <OverlayEditor show={show} channel={editing} act={act} client={client} onClose={() => setEditing(null)} />}
    </div>
  );
}
