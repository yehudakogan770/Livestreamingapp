import { CalendarCog, Heart, Mic2, Music, Presentation, Square, Trophy, Video, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { appLogo } from '../engine/brand';
import { defaultCountdown, type EngineClient } from '../engine/client';
import type { AtZero } from '../engine/types/AtZero';
import type { SafeScreen } from '../engine/types/SafeScreen';
import type { Show } from '../engine/types/Show';
import { backupOf, lineupOf, logoInput } from '../engine/backup';
import { TEMPLATES, templateActions, type TemplateId } from '../engine/eventTemplates';
import './EventSetup.css';

const TEMPLATE_ICONS: Record<TemplateId, LucideIcon> = {
  conference: Presentation,
  concert: Music,
  wedding: Heart,
  sports: Trophy,
  panel: Mic2,
  webinar: Video,
};

const countdownsOf = (show: Show) => show.sources.flatMap((s) => (s.kind.type === 'countdown' ? [{ id: s.id, timer: s.kind.timer }] : []));

type Ending = 'takeNext' | 'logo' | 'showText' | 'blank' | 'hold';

/**
 * Asked when an event starts (and from the Event menu): the event's name and
 * logo, and what the screens do in an emergency and when the countdown
 * ends. Nothing changes until Done; Skip keeps the safe choices (black).
 */
export function EventSetup({ show, client, onClose, onError }: { show: Show; client: EngineClient; onClose: () => void; onError: (e: unknown) => void }) {
  const ev = show.event;
  const [step, setStep] = useState(0);
  // A new, empty event can start from a template (once; never over inputs already made).
  const [offerTemplates] = useState(() => !ev.setUp && show.sources.length === 0);
  const [template, setTemplate] = useState<TemplateId | null>(null);
  const [name, setName] = useState(ev.name);
  const [logo, setLogo] = useState<string | null>(ev.logo);
  const [onFailure, setOnFailure] = useState<SafeScreen>(ev.onFailure);
  const [panicShows, setPanicShows] = useState<SafeScreen>(ev.panicShows);
  const backup = backupOf(show);
  const [backupOn, setBackupOn] = useState(backup.on);
  const lineupIds = lineupOf(show);
  const lineup = lineupIds.map((id) => show.sources.find((s) => s.id === id)?.name ?? id);
  const endsOnLogo = lineupIds.at(-1) === logoInput(show)?.id;
  // The countdown ending applies to every countdown input (and new ones copy it).
  const cds = countdownsOf(show);
  const firstTimer = cds[0]?.timer ?? defaultCountdown();
  const z = firstTimer.atZero.type;
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
        if (offerTemplates && template) for (const a of templateActions(template, show)) await client.dispatch(a);
        await client.dispatch({ type: 'updateEvent', patch: { name, logo: logo ?? '', onFailure, panicShows, setUp: true } });
        if (backupOn !== backup.on) await client.dispatch({ type: 'setBackupOn', value: backupOn });
        const atZero: AtZero = ending === 'logo' ? { type: 'hide' } : { type: ending };
        // A template's countdowns end the same way.
        const all = offerTemplates && template ? countdownsOf((await client.getShow()).show) : cds;
        for (const cd of all) {
          if (JSON.stringify(atZero) !== JSON.stringify(cd.timer.atZero)) await client.dispatch({ type: 'updateCountdown', id: cd.id, patch: { atZero } });
        }
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
  // Until the event has its own logo, Lumora's is shown.
  const withLogo = (
    <span className="evs__black">
      <img src={logoUrl ?? appLogo()} alt="" />
    </span>
  );

  const chosen = TEMPLATES.find((t) => t.id === template) ?? null;
  const templateStep = (
    <div className="evs__step" key="kind">
      <h3>What kind of event?</h3>
      <div className="evs__tpls" role="group" aria-label="Kind of event">
        {TEMPLATES.map((t) => {
          const Icon = TEMPLATE_ICONS[t.id];
          return (
            <button key={t.id} type="button" className="evs__tpl" aria-pressed={template === t.id} onClick={() => setTemplate(t.id)}>
              <Icon aria-hidden="true" />
              <strong>{t.name}</strong>
              <span>{t.blurb}</span>
            </button>
          );
        })}
        <button type="button" className="evs__tpl" aria-pressed={template === null} onClick={() => setTemplate(null)}>
          <Square aria-hidden="true" />
          <strong>Start empty</strong>
          <span>Add your own inputs</span>
        </button>
      </div>
      <p className="field__note">
        {chosen
          ? `Adds: ${chosen.adds.join(', ')}, and a run of show to fill in. Change or remove any of it later.`
          : 'Nothing is added. You can add inputs with + Add input at any time.'}
      </p>
    </div>
  );

  const steps = [
    ...(offerTemplates ? [templateStep] : []),
    <div className="evs__step" key="about">
      <h3>Your event</h3>
      <label className="field">
        <span className="field__label">Name of the event</span>
        <input
          className="text"
          autoFocus={!offerTemplates}
          value={name}
          maxLength={80}
          placeholder="e.g. Spring Gala 2026"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="field">
        <span className="field__label">Event logo</span>
        <div className="evs__logo">
          <span className="evs__logobox">
            {logoUrl ? <img src={logoUrl} alt="Event logo" /> : <img src={appLogo()} alt="Lumora logo (until you choose yours)" />}
          </span>
          <div className="evs__logobtns">
            <button type="button" className="btn" onClick={() => void pick()}>
              {logo ? 'Choose a different picture…' : 'Choose picture…'}
            </button>
            {logo && (
              <button type="button" className="linkbtn" onClick={() => setLogo(null)}>
                Remove
              </button>
            )}
          </div>
        </div>
        <span className="field__note">
          Shown when the countdown ends, if something breaks, and during PANIC. Until you choose one, the Lumora logo is used. A PNG with a see-through
          background looks best.
        </span>
      </div>
    </div>,
    <div className="evs__step" key="emergency">
      <h3>In an emergency</h3>
      <div className="field">
        <span className="field__label">If a camera or video stops working, that screen shows</span>
        <div className="evs__choices">
          <Choice on={onFailure === 'black'} onPick={() => setOnFailure('black')} title="Black" preview={black} />
          <Choice on={onFailure === 'logo'} onPick={() => setOnFailure('logo')} title="The logo" preview={withLogo} />
        </div>
      </div>
      <div className="field">
        <span className="field__label">If the camera on air goes out</span>
        <label className="check">
          <input type="checkbox" checked={backupOn} onChange={(e) => setBackupOn(e.target.checked)} /> Switch to the next one in the backup lineup by itself
        </label>
        <span className="field__note">
          {lineup.length >= 2
            ? `The lineup: ${lineup.join(' → ')}${endsOnLogo ? '' : ', then the logo'}.`
            : 'Once the event has two or more cameras, they back each other up.'}{' '}
          Change the order in Settings → Backup lineup….
        </span>
      </div>
      <div className="field">
        <span className="field__label">The PANIC button shows</span>
        <div className="evs__choices">
          <Choice on={panicShows === 'black'} onPick={() => setPanicShows('black')} title="Black" preview={black} />
          <Choice on={panicShows === 'logo'} onPick={() => setPanicShows('logo')} title="The logo" preview={withLogo} />
        </div>
      </div>
      <span className="field__note">The audience never sees an error message: whatever happens, they see your choice.</span>
    </div>,
    <div className="evs__step" key="countdown">
      <h3>When the countdown finishes</h3>
      <div className="evs__choices evs__choices--4">
        <Choice
          on={ending === 'takeNext'}
          onPick={() => setEnding('takeNext')}
          title="Go to what is in Next"
          preview={<span className="evs__black evs__words">Next ›</span>}
        />
        <Choice on={ending === 'logo'} onPick={() => setEnding('logo')} title="Numbers go, logo appears" preview={withLogo}>
          The background stays
        </Choice>
        <Choice
          on={ending === 'showText'}
          onPick={() => setEnding('showText')}
          title="Show words"
          preview={<span className="evs__black evs__words">{firstTimer.endText}</span>}
        >
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
          <h2>
            <CalendarCog className="modal__icon" aria-hidden="true" />
            Set up the event
          </h2>
          <span className="evs__dots" aria-label={`Step ${step + 1} of ${steps.length}`}>
            {steps.map((_, i) => (
              <i key={i} className={i === step ? 'is-on' : i < step ? 'is-done' : ''} />
            ))}
          </span>
        </header>
        <div className="evs__body">{steps[step]}</div>
        <footer className="modal__foot">
          <button type="button" className="linkbtn" onClick={() => void finish(true)}>
            Skip for now
          </button>
          <span className="grow" />
          {step > 0 && (
            <button type="button" className="btn" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {step < steps.length - 1 ? (
            <button type="button" className="btn btn--primary" onClick={() => setStep(step + 1)}>
              Next
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => void finish(false)}>
              Done
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
