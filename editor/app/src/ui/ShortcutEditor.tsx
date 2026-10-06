// The keyboard shortcut editor: pick a ready-made set, then give any command
// other keys (press them); keys another command has are pointed out.
import { X } from 'lucide-react';
import { useState } from 'react';
import { assign, COMMANDS, comboOf, conflicts, holderOf, keys, PRESETS, unassign, useKeys } from './shortcuts';
import { Modal } from './controls';
import './delivery.css';

export function ShortcutEditor({ onClose }: { onClose: () => void }) {
  const k = useKeys();
  const [listening, setListening] = useState<string | null>(null);
  const [pending, setPending] = useState<{ cmd: string; combo: string; holder: string } | null>(null);
  const [filter, setFilter] = useState('');
  const clashes = conflicts(k.bindings);
  const clashed = new Set([...clashes.values()].flat());
  const label = (id: string) => COMMANDS.find((c) => c.id === id)?.label ?? id;
  const q = filter.trim().toLowerCase();
  const shown = COMMANDS.filter((c) => !q || c.label.toLowerCase().includes(q) || (k.bindings[c.id] ?? []).some((x) => x.toLowerCase().includes(q)));
  const groups = [...new Set(shown.map((c) => c.group))];

  const take = (cmd: string, e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return setListening(null);
    const combo = comboOf(e.nativeEvent);
    if (!combo) return;
    setListening(null);
    const holder = holderOf(k.bindings, combo, cmd);
    if (holder) setPending({ cmd, combo, holder });
    else keys.setBindings(assign(k.bindings, cmd, combo));
  };

  return (
    <Modal title="Keyboard shortcuts" onClose={() => !listening && onClose()} wide>
      <div className="keys">
        <div className="keys__bar">
          <span>Set</span>
          <select className="text" value={k.preset} onChange={(e) => keys.usePreset(e.target.value)} aria-label="Shortcut set">
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {Object.keys(k.custom).length > 0 && (
            <button type="button" className="btn btn--sm" onClick={() => keys.usePreset(k.preset)}>
              Undo my changes
            </button>
          )}
          <span className="ed__fill" />
          <input
            className="text"
            placeholder="Find a command or key"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        {clashes.size > 0 && (
          <p className="form__problem">
            {[...clashes].map(([combo, cmds]) => `${combo}: ${cmds.map(label).join(' and ')}`).join(' · ')} (the first one listed gets it)
          </p>
        )}
        {pending && (
          <p className="form__problem">
            {pending.combo} is already {label(pending.holder)}.{' '}
            <button
              type="button"
              className="linkbtn"
              onClick={() => {
                keys.setBindings(assign(k.bindings, pending.cmd, pending.combo, true));
                setPending(null);
              }}
            >
              Give it to {label(pending.cmd)}
            </button>{' '}
            <button type="button" className="linkbtn" onClick={() => setPending(null)}>
              Keep it
            </button>
          </p>
        )}
        <div className="keys__list">
          {groups.map((g) => (
            <div key={g}>
              <div className="keys__group">{g}</div>
              {shown
                .filter((c) => c.group === g)
                .map((c) => (
                  <div key={c.id} className={`keys__row${clashed.has(c.id) ? ' is-clash' : ''}`}>
                    <span className="keys__label">{c.label}</span>
                    {(k.bindings[c.id] ?? []).map((combo) => (
                      <span key={combo} className="kbd">
                        {combo}
                        <button
                          type="button"
                          aria-label={`Remove ${combo} from ${c.label}`}
                          onClick={() => keys.setBindings(unassign(k.bindings, c.id, combo))}
                        >
                          <X />
                        </button>
                      </span>
                    ))}
                    {listening === c.id ? (
                      <button type="button" className="kbd kbd--listen" autoFocus onKeyDown={(e) => take(c.id, e)} onBlur={() => setListening(null)}>
                        Press keys… (Esc: cancel)
                      </button>
                    ) : (
                      <button type="button" className="linkbtn" onClick={() => setListening(c.id)} aria-label={`Add keys for ${c.label}`}>
                        + keys
                      </button>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
