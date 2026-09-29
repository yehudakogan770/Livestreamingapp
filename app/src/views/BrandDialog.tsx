import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Brand } from '../engine/types/Brand';
import type { Show } from '../engine/types/Show';
import { branded, defaultBrand } from '../engine/brand';
import { ACCENTS, defaultTextStyle, TEXT_DESIGNS, TEXT_FONTS } from '../engine/text';
import { TextView } from '../components/TextView';
import './StingerDialog.css';

/** The event's look: one font, colours and design for every title, song and scoreboard. */
export function BrandDialog({ show, client, onClose }: { show: Show; client: EngineClient; onClose: () => void }) {
  const [b, setB] = useState<Brand>(() => ({ ...defaultBrand(), ...show.event.brand }));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const set = (p: Partial<Brand>) => setB((x) => ({ ...x, ...p }));
  const titles = show.sources.filter((s) => s.kind.type === 'text' || s.kind.type === 'lyrics' || s.kind.type === 'scoreboard').length;
  const sample = {
    layout: 'lowerThird' as const,
    text: show.event.name || 'Speaker name',
    sub: 'Title or role',
    style: branded({ ...defaultTextStyle(), animate: false }, b),
  };
  const apply = () =>
    void client
      .dispatch({ type: 'applyBrand', brand: b })
      .then(onClose)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Event look" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box stg">
        <header className="modal__head">
          <h2>Event look</h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="stg__body">
          <div className="stg__stage" style={{ background: 'linear-gradient(135deg, #2c3a4f, #151a22)' }}>
            <TextView t={sample} />
          </div>
          <div className="stg__row">
            <label className="field">
              <span className="field__label">Font</span>
              <select value={b.font} onChange={(e) => set({ font: e.target.value })} aria-label="Font">
                {TEXT_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Words</span>
              <input type="color" value={b.textColor} onChange={(e) => set({ textColor: e.target.value })} aria-label="Words colour" />
            </label>
            <label className="field">
              <span className="field__label">Box</span>
              <input type="color" value={b.boxColor} onChange={(e) => set({ boxColor: e.target.value })} aria-label="Box colour" />
            </label>
            <label className="field">
              <span className="field__label">Box opacity · {b.boxOpacity}%</span>
              <input
                type="range"
                min={0}
                max={100}
                value={b.boxOpacity}
                onChange={(e) => set({ boxOpacity: Number(e.target.value) })}
                aria-label="Box opacity"
              />
            </label>
          </div>
          <div className="stg__row">
            <span className="field__label">Accent</span>
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                className="txed__swatch"
                style={{
                  background: c,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  border: b.accent === c ? '2px solid var(--text)' : '2px solid transparent',
                }}
                aria-label={`Accent ${c}`}
                aria-pressed={b.accent === c}
                onClick={() => set({ accent: c })}
              />
            ))}
            <input type="color" value={b.accent} onChange={(e) => set({ accent: e.target.value })} aria-label="Accent colour" />
          </div>
          <div className="stg__row">
            <span className="field__label">Design</span>
            {TEXT_DESIGNS.map((d) => (
              <button key={d.id} type="button" className="seg" aria-pressed={b.design === d.id} title={d.hint} onClick={() => set({ design: d.id })}>
                {d.name}
              </button>
            ))}
          </div>
          <p className="field__note">
            Applies to every title ({titles} now), the font and colour of songs, and the home team colour on scoreboards. New titles come in this look too.
          </p>
          {error && (
            <p className="field__note field__note--warn" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={() => setB(defaultBrand())}>
            Back to the start look
          </button>
          <span className="remote__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={apply}>
            Apply to everything
          </button>
        </footer>
      </div>
    </div>
  );
}
