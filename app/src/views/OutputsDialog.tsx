import { useEffect, useState } from 'react';
import type { Display, EngineClient } from '../engine/client';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import { SCREENS } from '../components/ScreenSelector';
import type { Act } from './act';
import { expectedCloses } from '../problems/watchers';

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
  // Display choices are applied on Done; Open / Close act straight away.
  const [chosenAll, setChosenAll] = useState({ ...show.settings.displays });
  const done = () => {
    for (const s of SCREENS) {
      if (chosenAll[s.id] !== show.settings.displays[s.id]) act({ type: 'setDisplay', screen: s.id, displayId: chosenAll[s.id] ?? undefined });
    }
    onClose();
  };
  const refresh = () => void client.listDisplays().then(setDisplays, onError);
  useEffect(refresh, [client]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const used = (id: string, except: ScreenId) => SCREENS.some((s) => s.id !== except && chosenAll[s.id] === id);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Outputs" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box outputs">
        <header className="modal__head">
          <h2>Outputs</h2>
          <button type="button" className="icon" aria-label="Close without saving" onClick={onClose}>
            ✕
          </button>
        </header>
        <p className="outputs__intro">
          Pick the display each screen goes to. Lumora remembers it for next time. With a display chosen, the output fills it; with “Window” it opens as a
          normal window you can move and resize.
        </p>
        <div className="outputs__rows">
          {SCREENS.map((s) => {
            const isOpen = open.includes(s.id);
            const chosen = chosenAll[s.id];
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
                  onChange={(e) => setChosenAll((c) => ({ ...c, [s.id]: e.target.value || null }))}
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
                  onClick={() => {
                    if (isOpen) expectedCloses.add(s.id);
                    void (isOpen ? client.closeOutput(s.id) : client.openOutput(s.id)).catch(onError);
                  }}
                >
                  {isOpen ? 'Close' : 'Open'}
                </button>
              </div>
            );
          })}
          <MultiviewRow show={show} client={client} displays={displays} act={act} onError={onError} />
        </div>
        <footer className="modal__foot">
          <button type="button" className="linkbtn" onClick={refresh}>
            Look for displays again
          </button>
          <span className="grow" />
          <button type="button" className="btn" onClick={() => SCREENS.forEach((s) => void client.openOutput(s.id).catch(onError))}>
            Open all three
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={done}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

/** The multiview: every input and the screens on one extra display, for the crew. */
function MultiviewRow({
  show,
  client,
  displays,
  act,
  onError,
}: {
  show: Show;
  client: EngineClient;
  displays: Display[] | null;
  act: Act;
  onError: (e: unknown) => void;
}) {
  const [isOpen, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () =>
      void client.multiviewOpen().then(
        (o) => alive && setOpen(o),
        () => undefined,
      );
    check();
    const id = setInterval(check, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [client]);
  const mv = show.settings.multiview;
  const set = (p: Partial<typeof mv>) => act({ type: 'setMultiview', multiview: { ...mv, ...p } });
  return (
    <div className="outputs__row">
      <div className="outputs__screen">
        <strong>Multiview</strong>
        <span>Every input and the screens, for the crew</span>
      </div>
      <span className="outputs__mv">
        <select aria-label="Display for the multiview" value={mv.display ?? ''} onChange={(e) => set({ display: e.target.value || null })}>
          <option value="">Window (no display chosen)</option>
          {displays?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.id} · {d.width}×{d.height}
              {d.primary ? ' · main screen' : ''}
            </option>
          ))}
        </select>
        <select aria-label="Multiview layout" value={mv.layout} onChange={(e) => set({ layout: e.target.value as typeof mv.layout })}>
          <option value="classic">Next + On air big, inputs below</option>
          <option value="bothScreens">Live and Back Screens, inputs below</option>
          <option value="inputs">Only the inputs, all the same size</option>
        </select>
      </span>
      <span className={`outputs__state${isOpen ? ' is-open' : ''}`}>{isOpen ? 'Open' : 'Closed'}</span>
      <button
        type="button"
        className={`btn${isOpen ? '' : ' btn--primary'}`}
        onClick={() => void (isOpen ? client.closeMultiview() : client.openMultiview()).then(() => setOpen(!isOpen), onError)}
      >
        {isOpen ? 'Close' : 'Open'}
      </button>
    </div>
  );
}
