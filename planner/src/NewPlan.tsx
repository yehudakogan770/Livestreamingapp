import { useEffect, useState, type FormEvent } from 'react';
import { copyPlan, listTemplates, type TemplateSummary } from './apiPro';
import { Dialog } from './Dialogs';
import { TEMPLATES } from './templates';
import { planFromTemplate } from './fromTemplate';
import { db } from './session';
import './pro.css';

/**
 * A new plan: blank, from one of the Planner's templates (conference, show,
 * concert…), or from one of your own. `onBlank` makes a blank one the usual way.
 */
export function NewPlanDialog({
  userId,
  initialName = '',
  initialDate = '',
  onBlank,
  onMade,
  onClose,
}: {
  userId: string;
  initialName?: string;
  initialDate?: string;
  onBlank: (name: string, date: string) => Promise<void>;
  onMade: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [date, setDate] = useState(initialDate);
  const [pick, setPick] = useState<string>('blank');
  const [mine, setMine] = useState<TemplateSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void listTemplates(db()).then(setMine);
  }, []);
  const make = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const built = TEMPLATES.find((t) => `t:${t.id}` === pick);
    const own = mine.find((t) => `m:${t.id}` === pick);
    const go: Promise<unknown> = built
      ? planFromTemplate(db(), built, name.trim() || built.name, date, userId).then(onMade)
      : own
        ? copyPlan(db(), own.id, name.trim() || own.name.replace(/ template$/i, ''), false, date).then(onMade)
        : onBlank(name.trim() || 'Untitled plan', date);
    go.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setBusy(false));
  };
  return (
    <Dialog title="New plan" onClose={onClose} wide>
      <form className="newplan" onSubmit={make}>
        <div className="row row--wrap">
          <label className="field grow">
            <span>Event name</span>
            <input className="input" value={name} maxLength={120} autoFocus placeholder="e.g. Fall gala" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Date</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <div className="field">
          <span>Start from</span>
          <div className="choices choices--grid" role="radiogroup" aria-label="Start from">
            <button
              type="button"
              role="radio"
              aria-checked={pick === 'blank'}
              className={`choice${pick === 'blank' ? ' is-on' : ''}`}
              onClick={() => setPick('blank')}
            >
              <b>Blank plan</b>
              <span className="muted small">No cues yet.</span>
            </button>
            {mine.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={pick === `m:${t.id}`}
                className={`choice${pick === `m:${t.id}` ? ' is-on' : ''}`}
                onClick={() => setPick(`m:${t.id}`)}
              >
                <b>{t.name}</b>
                <span className="muted small">Your template{t.venue ? ` · ${t.venue}` : ''}</span>
              </button>
            ))}
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={pick === `t:${t.id}`}
                className={`choice${pick === `t:${t.id}` ? ' is-on' : ''}`}
                onClick={() => setPick(`t:${t.id}`)}
              >
                <b>{t.name}</b>
                <span className="muted small">{t.what}</span>
              </button>
            ))}
          </div>
          <span className="muted small">Templates bring cues, the day’s schedule, crew positions, tasks and gear: change anything after.</span>
        </div>
        {error && <p className="warn">{error}</p>}
        <div className="row">
          <span className="bar__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Making the plan…' : 'Make the plan'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
