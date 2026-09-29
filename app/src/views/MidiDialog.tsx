import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Show } from '../engine/types/Show';
import type { ScreenId } from '../engine/types/ScreenId';
import { keyName, loadMidiMap, MidiIn, midiAction, MIDI_FUNCTIONS, saveMidiMap, type MidiMap } from '../engine/midi';
import type { Act } from './act';
import './MidiDialog.css';

// One MIDI connection for the control window, shared by the dialog and the show.
let midi: MidiIn | null = null;
let map: MidiMap = loadMidiMap();
/** The function waiting for its button (Learn), or null. */
let learning: string | null = null;
let version = 0;
const subs = new Set<() => void>();
const changed = () => {
  version++;
  subs.forEach((s) => s());
};
const useMidiState = () =>
  useSyncExternalStore(
    (l) => {
      subs.add(l);
      return () => subs.delete(l);
    },
    () => version,
  );

function setMap(m: MidiMap) {
  map = m;
  saveMidiMap(m);
  changed();
}

/** Run the show from MIDI: learned buttons and faders act on the screen being controlled. */
export function useMidiControl(show: Show, screen: ScreenId, act: Act): void {
  const latest = useRef({ show, screen, act });
  latest.current = { show, screen, act };
  useEffect(() => {
    if (!midi) {
      midi = new MidiIn();
      midi.onDevices = changed;
      void midi.start().then(changed);
    }
    const last = new Map<string, boolean>();
    return midi.listen((msg) => {
      if (learning) {
        // Only a press or a movement teaches, never a release.
        const fader = MIDI_FUNCTIONS.find((f) => f.id === learning)?.kind === 'fader';
        if (!fader && !msg.press) return;
        const next = Object.fromEntries(Object.entries(map).filter(([, k]) => k !== msg.key));
        next[learning] = msg.key;
        learning = null;
        setMap(next);
        return;
      }
      const { show, screen, act } = latest.current;
      for (const f of MIDI_FUNCTIONS) {
        if (map[f.id] !== msg.key) continue;
        if (f.kind === 'button') {
          // Buttons act once per press (CC buttons send a value while held).
          const was = last.get(msg.key) ?? false;
          last.set(msg.key, msg.press);
          if (!msg.press || was) continue;
        }
        const a = midiAction(f.id, msg.value, show, screen);
        if (a) act(a);
      }
    });
  }, []);
}

/** Set up a MIDI controller: press Learn, then the button or fader. */
export function MidiDialog({ onClose }: { onClose: () => void }) {
  useMidiState();
  const [, force] = useState(0);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (learning) {
        learning = null;
        changed();
      } else onClose();
    };
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('keydown', esc);
      learning = null;
    };
  }, [onClose]);
  const learn = (id: string) => {
    learning = learning === id ? null : id;
    changed();
    force((n) => n + 1);
  };
  const clear = (id: string) => {
    const next = { ...map };
    delete next[id];
    setMap(next);
  };
  const groups = [...new Set(MIDI_FUNCTIONS.map((f) => f.group))];
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="MIDI controller" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box midi">
        <header className="modal__head">
          <h2>MIDI controller</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="midi__body">
          <p className={`field__note${midi?.error ? ' field__note--warn' : ''}`}>
            {midi?.error ??
              (midi?.devices.length
                ? `Connected: ${midi.devices.join(', ')}. Press Learn, then the button or fader on the controller.`
                : 'No MIDI controller found. Plug one in by USB — it shows up here by itself.')}
          </p>
          {groups.map((g) => (
            <section key={g} className="midi__group">
              <h3>{g}</h3>
              {MIDI_FUNCTIONS.filter((f) => f.group === g).map((f) => (
                <div key={f.id} className={`midi__row${learning === f.id ? ' is-learning' : ''}`}>
                  <span className="midi__name">
                    {f.name}
                    {f.kind === 'fader' && <em> fader</em>}
                  </span>
                  <span className="midi__key">
                    {learning === f.id ? (f.kind === 'fader' ? 'Move the fader…' : 'Press the button…') : map[f.id] ? keyName(map[f.id]!) : '—'}
                  </span>
                  <button type="button" className={`btn btn--small${learning === f.id ? ' is-on' : ''}`} onClick={() => learn(f.id)}>
                    {learning === f.id ? 'Cancel' : 'Learn'}
                  </button>
                  <button type="button" className="icon" aria-label={`Forget ${f.name}`} disabled={!map[f.id]} onClick={() => clear(f.id)}>
                    ✕
                  </button>
                </div>
              ))}
            </section>
          ))}
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={() => setMap({})} disabled={Object.keys(map).length === 0}>
            Forget all
          </button>
          <span className="remote__spacer" />
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
