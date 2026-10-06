import { CircleCheck, OctagonAlert, ShieldCheck, TriangleAlert, Wrench, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useProblemStore, useProblems, type Problem } from './problems';
import './problems.css';

/** The light on the bottom bar: all good, or how many problems. Click for the list. */
export function ProblemLight() {
  const problems = useProblems();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const errors = problems.filter((p) => p.level === 'error').length;
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  const state = problems.length === 0 ? 'ok' : errors ? 'error' : 'warning';
  return (
    <div ref={ref} className="plight">
      <button type="button" className={`btn plight__btn plight__btn--${state}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        {state === 'ok' ? <CircleCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
        {state === 'ok' ? 'All good' : `${problems.length} problem${problems.length === 1 ? '' : 's'}`}
      </button>
      {open && (
        <div className="plist" role="dialog" aria-label="Problems">
          <div className="plist__head">
            <ShieldCheck aria-hidden="true" />
            <span>Problem center</span>
            <span className="plist__count">{problems.length}</span>
            <button type="button" className="icon" aria-label="Close" onClick={() => setOpen(false)}>
              <X aria-hidden="true" />
            </button>
          </div>
          {problems.length === 0 ? (
            <p className="plist__none">
              <CircleCheck aria-hidden="true" />
              Everything is working.
            </p>
          ) : (
            problems.map((p) => <ProblemItem key={p.key} p={p} />)
          )}
        </div>
      )}
    </div>
  );
}

function ProblemItem({ p }: { p: Problem }) {
  const mins = Math.floor((Date.now() - p.since) / 60_000);
  return (
    <div className={`pitem pitem--${p.level}`}>
      <div className="pitem__title">
        {p.level === 'error' ? <OctagonAlert aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
        <span className="pitem__text">{p.title}</span>
        <small>{mins < 1 ? 'just now' : `${mins} min ago`}</small>
      </div>
      {p.detail && <div className="pitem__detail">{p.detail}</div>}
      {p.fix && (
        <div className="pitem__fix">
          <Wrench aria-hidden="true" />
          <span>What to do: {p.fix}</span>
        </div>
      )}
      {p.action && (
        <button type="button" className="btn btn--primary pitem__act" onClick={p.action.run}>
          {p.action.label}
        </button>
      )}
    </div>
  );
}

/** A message the moment a new problem appears. */
export function ProblemToasts() {
  const store = useProblemStore();
  const [shown, setShown] = useState<Problem[]>([]);
  useEffect(() => {
    if (!store) return;
    store.onNew = (p) => {
      setShown((s) => [...s.filter((x) => x.key !== p.key).slice(-2), p]);
      setTimeout(() => setShown((s) => s.filter((x) => x.key !== p.key || x.since !== p.since)), 7000);
    };
    return () => {
      store.onNew = null;
    };
  }, [store]);
  if (!shown.length) return null;
  return (
    <div className="ptoasts" role="alert">
      {shown.map((p) => (
        <div key={p.key + p.since} className={`ptoast ptoast--${p.level}`}>
          <strong>
            {p.level === 'error' ? <OctagonAlert aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
            {p.title}
          </strong>
          {p.detail && <span>{p.detail}</span>}
        </div>
      ))}
    </div>
  );
}
