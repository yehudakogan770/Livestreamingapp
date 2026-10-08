import { MonitorUp, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cardDevices, cardOutputStart, cardOutputStatus, cardOutputStop, connectionLabel, type CardDevice, type CardOutputStatus } from '../engine/decklink';
import { useUnifiedOn } from '../engine/unified';
import './DeckLinkPicker.css';

/** The formats a card can play program out in. */
export const OUT_FORMATS: { label: string; width: number; height: number; fps: number }[] = [
  { label: '1080p59.94', width: 1920, height: 1080, fps: 59.94 },
  { label: '1080p60', width: 1920, height: 1080, fps: 60 },
  { label: '1080p50', width: 1920, height: 1080, fps: 50 },
  { label: '1080p29.97', width: 1920, height: 1080, fps: 29.97 },
  { label: '1080p30', width: 1920, height: 1080, fps: 30 },
  { label: '1080p25', width: 1920, height: 1080, fps: 25 },
  { label: '1080p23.98', width: 1920, height: 1080, fps: 23.976 },
  { label: '720p59.94', width: 1280, height: 720, fps: 59.94 },
  { label: '720p50', width: 1280, height: 720, fps: 50 },
  { label: '2160p29.97', width: 3840, height: 2160, fps: 29.97 },
  { label: '2160p25', width: 3840, height: 2160, fps: 25 },
];

/** Settings → Blackmagic program out: the Live Screen on a card's SDI or HDMI output. */
export function DeckLinkOutputDialog({ onClose }: { onClose: () => void }) {
  const unified = useUnifiedOn();
  const [cards, setCards] = useState<CardDevice[] | null>(null);
  const [status, setStatus] = useState<CardOutputStatus>({ device: null, mode: null });
  const [device, setDevice] = useState('');
  const [format, setFormat] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    cardDevices().then(
      (list) => {
        const out = list.filter((d) => d.canPlayout);
        setCards(out);
        setDevice((d) => d || out[0]?.name || '');
      },
      (e: unknown) => {
        setCards([]);
        setProblem(e instanceof Error ? e.message : String(e));
      },
    );
    void cardOutputStatus().then(setStatus, () => {});
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const card = cards?.find((c) => c.name === device);
  const f = OUT_FORMATS[format]!;
  const start = () => {
    setBusy(true);
    setProblem(null);
    cardOutputStart(device, f.width, f.height, f.fps)
      .then(setStatus, (e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const stop = () => {
    setBusy(true);
    cardOutputStop()
      .then(() => setStatus({ device: null, mode: null }), () => {})
      .finally(() => setBusy(false));
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Blackmagic program out" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box cardout">
        <header className="modal__head">
          <h2>
            <MonitorUp className="modal__icon" aria-hidden="true" />
            Blackmagic program out
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="cardout__body">
          <p className="field__note">
            The Live Screen on a Blackmagic card’s SDI or HDMI output: to a projector, a recorder, a switcher or a long cable run.
          </p>
          {!unified && (
            <p className="field__note field__note--warn">Program out comes from the Unified engine: turn it on first (Settings → Engine).</p>
          )}
          {cards === null && <p className="field__note">Looking for Blackmagic cards…</p>}
          {cards && cards.length === 0 && !problem && <p className="field__note">No Blackmagic card with an output was found.</p>}
          {cards && cards.length > 0 && (
            <div className="cardout__row">
              <label className="field">
                <span className="field__label">Card</span>
                <select value={device} onChange={(e) => setDevice(e.target.value)} aria-label="Card">
                  {cards.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                      {c.outputs.length ? ` (${c.outputs.map(connectionLabel).join(', ')})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Format</span>
                <select value={format} onChange={(e) => setFormat(Number(e.target.value))} aria-label="Format">
                  {OUT_FORMATS.map((o, i) => (
                    <option key={o.label} value={i}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {problem && (
            <p className="field__note field__note--warn" role="alert">
              {problem}
            </p>
          )}
          <div className="cardout__row">
            {status.device ? (
              <button type="button" className="btn" onClick={stop} disabled={busy}>
                Stop program out
              </button>
            ) : (
              <button type="button" className="btn btn--primary" onClick={start} disabled={busy || !card || !unified}>
                Start program out
              </button>
            )}
            <span className={`cardout__state${status.device ? ' is-on' : ''}`} role="status">
              {status.device ? `Playing on ${status.device}, ${status.mode ?? ''}` : 'Off'}
            </span>
          </div>
          <p className="field__note">The picture is the Live Screen as the Unified engine draws it; the sound stays on the computer’s outputs.</p>
        </div>
      </div>
    </div>
  );
}
