import { Gauge, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { lufsText, targetHint, TARGETS, type LoudnessMeter as Meter } from '../audio/loudness';
import { useSound } from '../audio/SoundContext';

const KEY = 'lumora.loudnessTarget';

function savedTarget(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return TARGETS.some((t) => t.lufs === v) ? v : -14;
  } catch {
    return -14;
  }
}

interface Reading {
  momentary: number;
  shortTerm: number;
  integrated: number;
  seconds: number;
}

const read = (m: Meter): Reading => ({ momentary: m.momentary, shortTerm: m.shortTerm, integrated: m.integrated, seconds: m.seconds });

/** The Stream mix's loudness in LUFS, with how far it is from the target. */
export function LoudnessReadout({ meter: given }: { meter?: Meter }) {
  const sound = useSound();
  const meter = given ?? sound?.loudness ?? null;
  const [r, setR] = useState<Reading | null>(meter ? read(meter) : null);
  const [target, setTarget] = useState(savedTarget);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!meter) return;
    setR(read(meter));
    const id = setInterval(() => setR(read(meter)), 500);
    return () => clearInterval(id);
  }, [meter]);
  if (!meter || !r) return null;
  const hint = targetHint(r.shortTerm, target);
  const choose = (v: number) => {
    setTarget(v);
    try {
      localStorage.setItem(KEY, String(v));
    } catch {
      // Kept for this session only.
    }
  };
  const minutes = Math.floor(r.seconds / 60);
  return (
    <span className="lufs">
      <button
        type="button"
        className={`btn lufs__btn lufs--${hint.state}`}
        aria-expanded={open}
        title="Loudness of the Stream mix (the last 3 seconds)"
        onClick={() => setOpen((o) => !o)}
      >
        <Gauge aria-hidden="true" />
        <span className="lufs__num" data-testid="lufs-short">
          {lufsText(r.shortTerm)}
        </span>{' '}
        LUFS
      </button>
      {open && (
        <div className="lufs__pop" role="dialog" aria-label="Loudness">
          <dl className="lufs__list">
            <dt>Now (0.4 s)</dt>
            <dd>{lufsText(r.momentary)} LUFS</dd>
            <dt>Last 3 seconds</dt>
            <dd>{lufsText(r.shortTerm)} LUFS</dd>
            <dt>Whole event{r.seconds ? ` (${minutes ? `${minutes} min` : `${Math.round(r.seconds)} s`})` : ''}</dt>
            <dd data-testid="lufs-integrated">{lufsText(r.integrated)} LUFS</dd>
          </dl>
          <label className="field">
            <span className="field__label">Target</span>
            <select value={target} onChange={(e) => choose(Number(e.target.value))} aria-label="Loudness target">
              {TARGETS.map((t) => (
                <option key={t.lufs} value={t.lufs}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <p className={`lufs__hint lufs--${hint.state}`} role="status">
            {hint.text}
            {hint.state === 'low' && ': raise the Stream fader or the loudest channels.'}
            {hint.state === 'high' && ': lower the Stream fader.'}
          </p>
          <button
            type="button"
            className="btn btn--small"
            onClick={() => {
              meter.reset();
              setR(read(meter));
            }}
          >
            <RotateCcw aria-hidden="true" /> Start the whole-event reading again
          </button>
        </div>
      )}
    </span>
  );
}
