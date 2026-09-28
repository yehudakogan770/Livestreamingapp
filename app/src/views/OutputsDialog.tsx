import { useEffect, useState } from 'react';
import type { Display, EngineClient } from '../engine/client';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import { SCREENS } from '../components/ScreenSelector';
import type { Act } from './act';

/** Choose which display each screen goes to, and open or close each output. */
export function OutputsDialog({
  show,
  client,
  open,
  act,
  onClose,
  onError,
}: {
  show: Show;
  client: EngineClient;
  open: ScreenId[];
  act: Act;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [displays, setDisplays] = useState<Display[] | null>(null);
  const refresh = () => void client.listDisplays().then(setDisplays, onError);
  useEffect(refresh, [client]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const used = (id: string, except: ScreenId) => SCREENS.some((s) => s.id !== except && show.settings.displays[s.id] === id);

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Outputs"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal__box outputs">
        <header className="modal__head">
          <h2>Outputs</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <p className="outputs__intro">
          Pick the display each screen goes to. Lumora remembers it for next time. With a display chosen, the output fills it; with “Window”
          it opens as a normal window you can move and resize.
        </p>
        <div className="outputs__rows">
          {SCREENS.map((s) => {
            const isOpen = open.includes(s.id);
            const chosen = show.settings.displays[s.id];
            const missing = chosen !== null && displays !== null && !displays.some((d) => d.id === chosen);
            return (
              <div key={s.id} className="outputs__row">
                <div className="outputs__screen">
                  <strong>{s.name}</strong>
                  <span>{s.where}</span>
                </div>
                <select
                  aria-label={`Display for ${s.name}`}
                  value={chosen ?? ''}
                  onChange={(e) => act({ type: 'setDisplay', screen: s.id, displayId: e.target.value || undefined })}
                >
                  <option value="">Window (no display chosen)</option>
                  {displays?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.id} · {d.width}×{d.height}
                      {d.primary ? ' · main screen' : ''}
                      {used(d.id, s.id) ? ' · also used' : ''}
                    </option>
                  ))}
                  {missing && <option value={chosen}>{chosen} (not connected)</option>}
                </select>
                <span className={`outputs__state${isOpen ? ' is-open' : ''}`}>{isOpen ? 'Open' : 'Closed'}</span>
                <button
                  type="button"
                  className={`btn${isOpen ? '' : ' btn--primary'}`}
                  onClick={() => void (isOpen ? client.closeOutput(s.id) : client.openOutput(s.id)).catch(onError)}
                >
                  {isOpen ? 'Close' : 'Open'}
                </button>
              </div>
            );
          })}
        </div>
        <footer className="modal__foot">
          <button type="button" className="linkbtn" onClick={refresh}>
            Look for displays again
          </button>
          <span className="grow" />
          <button type="button" className="btn" onClick={() => SCREENS.forEach((s) => void client.openOutput(s.id).catch(onError))}>
            Open all three
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
