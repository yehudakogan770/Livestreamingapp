import { Mic, X } from 'lucide-react';
import { useEffect } from 'react';
import type { EngineClient } from '../engine/client';
import type { Show } from '../engine/types/Show';
import type { SpeakerNames } from '../engine/types/SpeakerNames';
import { showSpeaker } from '../engine/speakers';
import '../captions/captions.css';

/** Who speaks into which microphone; their name comes on by itself when they talk. */
export function SpeakersDialog({ show, client, onClose }: { show: Show; client: EngineClient; onClose: () => void }) {
  const s = show.speakers;
  const set = (p: Partial<SpeakerNames>) => void client.dispatch({ type: 'setSpeakerNames', speakers: { ...s, ...p } });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const mics = show.sources.filter((x) => x.kind.type === 'microphone');
  const person = (mic: string) => s.people.find((p) => p.mic === mic) ?? { mic, name: '', title: '' };
  const setPerson = (mic: string, patch: { name?: string; title?: string }) =>
    set({ people: [...s.people.filter((p) => p.mic !== mic), { ...person(mic), ...patch }] });
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Speaker names" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box cap">
        <header className="modal__head">
          <h2>
            <Mic className="modal__icon" aria-hidden="true" />
            Speaker names
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="cap__body">
          <label className="check cap__main">
            <input type="checkbox" checked={s.on} onChange={(e) => set({ on: e.target.checked })} /> When someone starts talking, put their name on by itself
          </label>
          <p className="field__note">
            Type who speaks into each microphone. When they talk for a moment, their name title comes on for a few seconds (not for a cough), on the Live
            Screen.
          </p>
          {mics.length === 0 && <p className="field__note field__note--warn">Add the speakers’ microphones as inputs first (Add input → Microphone).</p>}
          {mics.map((m) => {
            const p = person(m.id);
            return (
              <div key={m.id} className="cap__row">
                <label className="field cap__grow">
                  <span className="field__label">{m.name}: name</span>
                  <input className="text" value={p.name} placeholder="e.g. Sarah Cohen" onChange={(e) => setPerson(m.id, { name: e.target.value })} />
                </label>
                <label className="field cap__grow">
                  <span className="field__label">Title (optional)</span>
                  <input className="text" value={p.title} placeholder="e.g. Guest speaker" onChange={(e) => setPerson(m.id, { title: e.target.value })} />
                </label>
                <button type="button" className="btn" disabled={!p.name.trim()} onClick={() => void showSpeaker(show, client, m.id)}>
                  Show now
                </button>
              </div>
            );
          })}
          <div className="cap__row">
            <label className="field">
              <span className="field__label">On overlay</span>
              <select value={s.channel} onChange={(e) => set({ channel: Number(e.target.value) })}>
                {[0, 1, 2, 3].map((c) => (
                  <option key={c} value={c}>
                    {c + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Stays on</span>
              <select value={s.holdS} onChange={(e) => set({ holdS: Number(e.target.value) })}>
                {[4, 6, 8, 10, 15].map((v) => (
                  <option key={v} value={v}>
                    {v} seconds
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Same person again after</span>
              <select value={s.againMin} onChange={(e) => set({ againMin: Number(e.target.value) })}>
                {[1, 3, 5, 10, 30].map((v) => (
                  <option key={v} value={v}>
                    {v} min
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="field__note">The title uses the look of the “Speaker names” text input, made the first time; change its look there.</p>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
