import { useEffect, useState } from 'react';
import type { Place } from '../engine/types/Place';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import type { ZmanimStyle } from '../engine/types/ZmanimStyle';
import { formatHebrew, formatHebrewHe } from '../engine/hebcal';
import { CITIES, clockTime, defaultPlace, hasPlace, nextCandles, zmanimOn } from '../engine/zmanim';
import { zmanimRows } from '../components/ZmanimView';
import type { Act } from './act';
import './StingerDialog.css';
import './LyricsCard.css';

const LOOKS: { style: ZmanimStyle; label: string }[] = [
  { style: 'card', label: 'Hebrew date and zmanim' },
  { style: 'bar', label: 'A line along the bottom' },
  { style: 'countdown', label: 'Countdown to candle lighting' },
];

/** Where the event is, candle lighting, and what to do before Shabbos (and a zmanim input's look). */
export function ZmanimDialog({ show, act, source, onClose }: { show: Show; act: Act; source?: Source; onClose: () => void }) {
  const [p, setP] = useState<Place>(() => ({ ...defaultPlace(), ...show.event.place }));
  const [other, setOther] = useState(() => hasPlace(show.event.place) && !CITIES.some(([n]) => n === show.event.place.name));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const set = (x: Partial<Place>) => setP((q) => ({ ...q, ...x }));
  const pick = (name: string) => {
    if (name === '__other') {
      setOther(true);
      return;
    }
    const c = CITIES.find(([n]) => n === name);
    if (!c) return;
    setOther(false);
    set({
      name: c[0],
      latMicro: Math.round(c[1] * 1e6),
      lonMicro: Math.round(c[2] * 1e6),
      candleMinutes: c[3],
      israel: c[2] > 34 && c[2] < 36 && c[1] > 29 && c[1] < 34,
    });
  };
  const now = Date.now();
  const z = hasPlace(p) ? zmanimOn(now, p) : null;
  const next = hasPlace(p) ? nextCandles(now, p) : null;
  const look = source?.kind.type === 'zmanim' ? source.kind.style : null;
  const save = () => {
    act({ type: 'updateEvent', patch: { place: p } });
    onClose();
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Zmanim and Shabbos" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box stg">
        <header className="modal__head">
          <h2>Zmanim and Shabbos</h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="stg__body">
          {source && look && (
            <div className="field">
              <span className="field__label">How “{source.name}” looks</span>
              <div className="lyc__bar" role="group" aria-label="Look">
                {LOOKS.map((l) => (
                  <button
                    key={l.style}
                    type="button"
                    className={`btn btn--small${look === l.style ? ' is-on' : ''}`}
                    onClick={() => act({ type: 'updateZmanim', id: source.id, zmanim: { style: l.style } })}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="field">
            <span className="field__label">Where the event is</span>
            <select className="text" value={other ? '__other' : p.name} onChange={(e) => pick(e.target.value)} aria-label="City">
              {!hasPlace(p) && <option value="">Choose the city…</option>}
              {CITIES.map(([n]) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              <option value="__other">Another place (type its position)…</option>
            </select>
          </label>
          {other && (
            <div className="lyc__row">
              <input className="text" placeholder="Name" value={p.name} onChange={(e) => set({ name: e.target.value })} aria-label="Place name" />
              <input
                className="text"
                inputMode="decimal"
                placeholder="Latitude (40.71)"
                defaultValue={p.latMicro ? String(p.latMicro / 1e6) : ''}
                onChange={(e) => set({ latMicro: Math.round(Number(e.target.value) * 1e6) || 0 })}
                aria-label="Latitude"
              />
              <input
                className="text"
                inputMode="decimal"
                placeholder="Longitude (-74.00)"
                defaultValue={p.lonMicro ? String(p.lonMicro / 1e6) : ''}
                onChange={(e) => set({ lonMicro: Math.round(Number(e.target.value) * 1e6) || 0 })}
                aria-label="Longitude"
              />
            </div>
          )}
          <div className="lyc__row">
            <label className="field" style={{ width: 170 }}>
              <span className="field__label">Candles, minutes before sunset</span>
              <input
                className="text"
                type="number"
                min={0}
                max={90}
                value={p.candleMinutes}
                onChange={(e) => set({ candleMinutes: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })}
                aria-label="Minutes before sunset"
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={p.israel} onChange={(e) => set({ israel: e.target.checked })} /> In Israel (one day of Yom Tov)
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={p.stopBefore} onChange={(e) => set({ stopBefore: e.target.checked })} /> End the live stream and recording by
            themselves
            <input
              className="text"
              type="number"
              min={0}
              max={120}
              style={{ width: 64, margin: '0 6px' }}
              value={p.stopMinutes}
              onChange={(e) => set({ stopMinutes: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })}
              aria-label="Minutes before candle lighting"
            />
            minutes before candle lighting (a warning shows 10 minutes before)
          </label>
          <label className="check">
            <input type="checkbox" checked={p.warnMonitor} onChange={(e) => set({ warnMonitor: e.target.checked })} /> Tell the stage monitor in the last hour
            before candle lighting
          </label>
          {z && (
            <div className="zmd__today">
              <p>
                <b dir="rtl">{formatHebrewHe(z.hebrew)}</b> · {formatHebrew(z.hebrew)}
                {z.special.length > 0 && ` · ${z.special.join(' · ')}`}
              </p>
              <p className="field__note">
                {zmanimRows(z)
                  .map(([l, t]) => `${l} ${clockTime(t)}`)
                  .join(' · ')}
              </p>
              <p>
                {z.candles !== null
                  ? `🕯 Candle lighting today at ${clockTime(z.candles)}`
                  : next !== null
                    ? `🕯 Next candle lighting: ${new Date(next).toLocaleDateString('en-US', { weekday: 'long' })} at ${clockTime(next)}`
                    : ''}
              </p>
              <p className="field__note">Times are shown in this computer's time zone: set the computer's clock to the event's place.</p>
            </div>
          )}
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!hasPlace(p)} onClick={save}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
