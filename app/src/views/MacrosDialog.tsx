import { Circle, Play, Square, Workflow, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Macro } from '../engine/types/Macro';
import type { Show } from '../engine/types/Show';
import { StepsEditor, describeStep } from './PresetEditor';
import type { Act } from './act';
import { hotkeyProblem, hotkeyTaken, keyName, macroRecorder, macroTime, newMacroId, withMacroTime } from '../macros/macros';
import './TriggersDialog.css';
import './MacrosDialog.css';

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** A box that takes the next key pressed as the macro's key. */
function KeyBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [listening, setListening] = useState(false);
  return (
    <span className="mac__key">
      <button
        type="button"
        className={`btn${listening ? ' is-on' : ''}`}
        aria-label="Macro key"
        onClick={() => setListening(true)}
        onBlur={() => setListening(false)}
        onKeyDown={(e) => {
          if (!listening) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Escape') return setListening(false);
          const name = keyName(e.nativeEvent);
          if (!name) return;
          onChange(name);
          setListening(false);
        }}
      >
        {listening ? 'Press a key…' : value || 'No key'}
      </button>
      {value && !listening && (
        <button type="button" className="linkbtn" onClick={() => onChange('')}>
          Remove key
        </button>
      )}
    </span>
  );
}

/** Macros: a list of steps with waits, run by one button, a key, the Stream Deck, the API or at a set time. */
export function MacrosDialog({ show, act, onClose }: { show: Show; act: Act; onClose: () => void }) {
  const list = show.macros;
  const [sel, setSel] = useState<string | null>(list[0]?.id ?? null);
  const [recording, setRecording] = useState(macroRecorder.recording);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !recording && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, recording]);
  const save = (next: Macro[]) => act({ type: 'setMacros', macros: next });
  const m = list.find((x) => x.id === sel) ?? null;
  const change = (p: Partial<Macro>) => m && save(list.map((x) => (x.id === m.id ? { ...x, ...p } : x)));
  const add = () => {
    const id = newMacroId();
    save([...list, { id, name: `Macro ${list.length + 1}`, steps: [], hotkey: '' }]);
    setSel(id);
  };
  const at = m ? macroTime(show.triggers, m.id) : null;
  const setTime = (minute: number | null) =>
    m && act({ type: 'setTriggers', triggers: withMacroTime(show.triggers, m, minute, -new Date().getTimezoneOffset()) });
  const problem = m ? hotkeyProblem(m.hotkey) : null;
  const taken = m ? hotkeyTaken(list, m.id, m.hotkey) : null;

  // Recording: the dialog steps aside (it shrinks to a bar) while the operator works.
  const startRecording = () => {
    macroRecorder.start(Date.now());
    setRecording(true);
  };
  const stopRecording = () => {
    const steps = macroRecorder.stop();
    setRecording(false);
    if (m && steps.length) change({ steps: [...m.steps, ...steps].slice(0, 50) });
  };
  if (recording && m) {
    return (
      <div className="mac__recbar" role="status" aria-label="Recording a macro">
        <Circle className="mac__dot" aria-hidden="true" />
        <span>Recording “{m.name}”. Do the steps now (switching, overlays, countdown, presets); the pauses between are kept as waits.</span>
        <button type="button" className="btn btn--primary" onClick={stopRecording}>
          <Square aria-hidden="true" /> Stop recording
        </button>
      </div>
    );
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Macros" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box trg">
        <header className="modal__head">
          <h2>
            <Workflow className="modal__icon" aria-hidden="true" />
            Macros
          </h2>
          <span className="field__note trg__why">Several steps with one button, key, Stream Deck key or at a set time.</span>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="trg__body">
          <nav className="trg__list" aria-label="Macros">
            {list.map((x) => (
              <div key={x.id} className={`trg__item${x.id === sel ? ' is-on' : ''}`}>
                <button type="button" onClick={() => setSel(x.id)}>
                  <b>{x.name}</b>
                  <em>
                    {x.steps.length} step{x.steps.length === 1 ? '' : 's'}
                    {x.hotkey ? ` · ${x.hotkey}` : ''}
                    {macroTime(show.triggers, x.id) !== null ? ` · every day at ${hhmm(macroTime(show.triggers, x.id)!)}` : ''}
                  </em>
                </button>
                <button
                  type="button"
                  className="icon"
                  aria-label={`Run ${x.name}`}
                  title="Run it now"
                  disabled={!x.steps.length}
                  onClick={() => act({ type: 'runMacro', id: x.id })}
                >
                  <Play aria-hidden="true" />
                </button>
              </div>
            ))}
            {list.length === 0 && (
              <p className="field__note">No macros yet. For example “Start show”: start recording, wait 2 seconds, go live, put the countdown on air.</p>
            )}
            <button type="button" className="btn" onClick={add}>
              + Add a macro
            </button>
          </nav>
          <section className="trg__edit">
            {m ? (
              <>
                <label className="field">
                  <span className="field__label">Name</span>
                  <input className="text" value={m.name} maxLength={40} onChange={(e) => change({ name: e.target.value })} aria-label="Macro name" />
                </label>
                <div className="field">
                  <span className="field__label">Key</span>
                  <KeyBox value={m.hotkey} onChange={(hotkey) => change({ hotkey })} />
                  {(problem || taken) && <p className="field__note field__note--warn">{problem ?? `“${taken!.name}” already uses ${m.hotkey}.`}</p>}
                </div>
                <div className="field">
                  <span className="field__label">Every day at a set time</span>
                  <span className="mac__time">
                    <label className="check">
                      <input type="checkbox" checked={at !== null} onChange={(e) => setTime(e.target.checked ? 19 * 60 + 30 : null)} /> Run it by itself at
                    </label>
                    <input
                      className="text"
                      type="time"
                      disabled={at === null}
                      value={hhmm(at ?? 19 * 60 + 30)}
                      aria-label="Time"
                      onChange={(e) => {
                        const [h, mi] = e.target.value.split(':').map(Number);
                        setTime((h ?? 0) * 60 + (mi ?? 0));
                      }}
                    />
                  </span>
                </div>
                <span className="field__label">Steps</span>
                <StepsEditor show={show} screen="live" steps={m.steps} onChange={(steps) => change({ steps })} />
                <p className="field__note">
                  Recording, going live and replays are done by this computer’s control window. Run it from the Stream Deck, Companion or a script with its
                  name: <code>/api/do/macro?name={encodeURIComponent(m.name)}</code>
                </p>
                <div className="trg__foot">
                  <button type="button" className="btn btn--primary" onClick={() => act({ type: 'runMacro', id: m.id })} disabled={!m.steps.length}>
                    <Play aria-hidden="true" /> Run now
                  </button>
                  <button type="button" className="btn" onClick={startRecording} title={m.steps.map((s) => describeStep(s, show)).join('\n')}>
                    <Circle aria-hidden="true" /> Record steps
                  </button>
                  <span className="remote__spacer" />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      save(list.filter((x) => x.id !== m.id));
                      if (at !== null) setTime(null);
                      setSel(null);
                    }}
                  >
                    Delete macro
                  </button>
                </div>
              </>
            ) : (
              <p className="field__note">Choose a macro, or add one.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
