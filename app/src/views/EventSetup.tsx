import { useEffect, useState, type ReactNode } from 'react';
import type { EngineClient } from '../engine/client';
import type { AtZero } from '../engine/types/AtZero';
import type { SafeScreen } from '../engine/types/SafeScreen';
import type { Show } from '../engine/types/Show';
import './EventSetup.css';

type Ending = 'logo' | 'showText' | 'blank' | 'hold';

/**
 * Asked when an event starts (and from the Event menu): the event's name and
 * logo, and what the screens do in an emergency and when the countdown
 * ends. Nothing changes until Done; Skip keeps the safe choices (black).
 */
export function EventSetup({ show, client, onClose, onError }: { show: Show; client: EngineClient; onClose: () => void; onError: (e: unknown) => void }) {
  const ev = show.event;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(ev.name);
  const [logo, setLogo] = useState<string | null>(ev.logo);
  const [onFailure, setOnFailure] = useState<SafeScreen>(ev.onFailure);
  const [panicShows, setPanicShows] = useState<SafeScreen>(ev.panicShows);
  const z = show.countdown.atZero.type;
  const [ending, setEnding] = useState<Ending>(z === 'hide' ? 'logo' : z === 'cutTo' ? 'logo' : z);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const logoUrl = logo ? client.mediaUrl(logo) : null;
  const pick = async () => {
    const f = await client.pickFile('image').catch(onError);
    if (f) setLogo(f.path);
  };

  const finish = async (skip: boolean) => {
    try {
      if (skip) {
        await client.dispatch({ type: 'updateEvent', patch: { setUp: true } });
      } else {
        await client.dispatch({ type: 'updateEvent', patch: { name, logo: logo ?? '', onFailure, panicShows, setUp: true } });
        const atZero: AtZero = ending === 'logo' ? { type: 'hide' } : { type: ending };
        if (JSON.stringify(atZero) !== JSON.stringify(show.countdown.atZero)) await client.dispatch({ type: 'updateCountdown', patch: { atZero } });
      }
      onClose();
    } catch (e) {
      onError(e);
    }
  };

  const Choice = ({ on, onPick, title, children, preview }: { on: boolean; onPick: () => void; title: string; children?: ReactNode; preview: ReactNode }) => (
    <button type="button" className="evs__choice" aria-pressed={on} onClick={onPick}>
      <span className="evs__preview">{preview}</span>
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </button>
  );
  const black = <span className="evs__black" />;
  const withLogo = <span className="evs__black">{logoUrl ? <img src={logoUrl} alt="" /> : <em>no logo yet</em>}</span>;

  const steps = [
    <div className="evs__step" key="about">
      <h3>Your event</h3>
      <label className="field">
        <span className="field__label">Name of the event</span>
        <input className="text" autoFocus value={name} maxLength={80} placeholder="e.g. Chanukah Rally 2026" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        <span className="field__label">Event logo</span>
        <div className="evs__logo">
          <span className="evs__logobox">{logoUrl ? <img src={logoUrl} alt="Event logo" /> : <em>No logo chosen</em>}</span>
          <div className="evs__logobtns">
            <button type="button" className="btn" onClick={() => void pick()}>{logo ? 'Choose a different picture…' : 'Choose picture…'}</button>
            {logo && <button type="button" className="linkbtn" onClick={() => setLogo(null)}>Remove</button>}
          </div>
        </div>
        <span className="field__note">Used when the countdown ends and, if you choose, in emergencies. A PNG with a see-through background looks best.</span>
      </div>
    </div>,
    <div className="evs__step" key="emergency">
      <h3>In an emergency</h3>
      <div className="field">
        <span className="field__label">If a camera or video stops working, that screen shows</span>
        <div className="evs__choices">
          <Choice on={onFailure === 'black'} onPick={() => setOnFailure('black')} title="Black" preview={black} />
          <Choice on={onFailure === 'logo'} onPick={() => setOnFailure('logo')} title="The event logo" preview={withLogo} />
        </div>
      </div>
      <div className="field">
        <span className="field__label">The PANIC button shows</span>
        <div className="evs__choices">
          <Choice on={panicShows === 'black'} onPick={() => setPanicShows('black')} title="Black" preview={black} />
          <Choice on={panicShows === 'logo'} onPick={() => setPanicShows('logo')} title="The event logo" preview={withLogo} />
        </div>
      </div>
      <span className="field__note">The audience never sees an error message: whatever happens, they see your choice.</span>
    </div>,
    <div className="evs__step" key="countdown">
      <h3>When the countdown finishes</h3>
      <div className="evs__choices evs__choices--4">
        <Choice on={ending === 'logo'} onPick={() => setEnding('logo')} title="Numbers go, logo appears" preview={withLogo}>
          The background stays
        </Choice>
        <Choice on={ending === 'showText'} onPick={() => setEnding('showText')} title="Show words" preview={<span className="evs__black evs__words">{show.countdown.endText}</span>}>
          Set the words under More…
        </Choice>
        <Choice on={ending === 'blank'} onPick={() => setEnding('blank')} title="Go to black" preview={black} />
        <Choice on={ending === 'hold'} onPick={() => setEnding('hold')} title="Stay on 0" preview={<span className="evs__black evs__words">0</span>} />
      </div>
    </div>,
  ];

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Event setup">
      <div className="modal__box evs">
        <header className="modal__head">
          <h2>Set up the event</h2>
          <span className="evs__dots" aria-label={`Step ${step + 1} of 3`}>
            {steps.map((_, i) => (
              <i key={i} className={i === step ? 'is-on' : i < step ? 'is-done' : ''} />
            ))}
          </span>
        </header>
        <div className="evs__body">{steps[step]}</div>
        <footer className="modal__foot">
          <button type="button" className="linkbtn" onClick={() => void finish(true)}>Skip for now</button>
          <span className="grow" />
          {step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Back</button>}
          {step < steps.length - 1 ? (
            <button type="button" className="btn btn--primary" onClick={() => setStep(step + 1)}>Next</button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => void finish(false)}>Done</button>
          )}
        </footer>
      </div>
    </div>
  );
}
