// A Titler graphic's card: its fields as a control panel made from the
// template (fill them in while it is on air), Take IN / Take OUT on the
// screen being controlled, and "Edit in Titler…" to change how it looks.

import { useEffect, useMemo, useState } from 'react';
import { PanelBottom, X } from 'lucide-react';
import { ControlPanel } from '../../../titler/src/designer/ControlPanel';
import { fromTemplate, starterTemplates } from '../../../titler/src/core/templates';
import type { EngineClient } from '../engine/client';
import { overlayActions, overlayChannel } from '../engine/overlays';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import type { Act } from '../views/act';
import { openTitler } from './LumoraTitler';
import { TitlerView } from './TitlerView';
import { projectOf, titlerKind, valuesOf } from './titlerSource';
import './titler.css';

export function TitlerCard({ source, show, act, client, screen = 'live', onClose }: { source: Source; show: Show; act: Act; client: EngineClient; screen?: ScreenId; onClose: () => void }) {
  const k = source.kind.type === 'titler' ? source.kind : null;
  const project = useMemo(() => (k ? projectOf(k) : null), [k?.template]); // eslint-disable-line react-hooks/exhaustive-deps
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener('keydown', esc);
      clearInterval(id);
    };
  }, [onClose]);
  if (!k) return null;
  const { values, bound } = project ? valuesOf(project, k, show, now) : { values: {}, bound: {} };
  const channel = show.overlays.findIndex((o) => o.sourceId === source.id);
  const onAir = channel >= 0 && show.overlays[channel]!.on;
  const scoreboards = show.sources.filter((s) => s.kind.type === 'scoreboard');
  const usesScore = !!project?.variables.some((v) => v.bind?.startsWith('score:'));
  const take = () => {
    for (const a of overlayActions(show, source.id, screen, true)) act(a);
  };
  const out = () => {
    if (channel >= 0) act({ type: 'setOverlayOn', channel, value: false });
  };
  const next = () => {
    for (const a of overlayActions(show, source.id, screen, false)) act(a);
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`Titler graphic: ${source.name}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box titler-card">
        <header className="modal__head">
          <h2>
            <PanelBottom className="modal__icon" aria-hidden="true" />
            {source.name}
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="titler-card__body">
          <div className="titler-card__preview" aria-label="Preview">
            <TitlerView source={source} show={show} urlFor={(p) => client.mediaUrl(p)} thumb />
          </div>
          {project ? (
            <ControlPanel project={project} values={values} bound={bound} onChange={(key, value) => act({ type: 'setTitlerValues', id: source.id, values: [{ key, value }] })} />
          ) : (
            <div className="titler-card__problem">
              This graphic&rsquo;s design could not be read.
              <button
                type="button"
                className="btn btn--small"
                onClick={() => act({ type: 'updateTitler', id: source.id, titler: { ...titlerKind(fromTemplate(starterTemplates()[0]!)), scoreboard: null } })}
              >
                Start again from a template
              </button>
            </div>
          )}
          {usesScore && scoreboards.length > 1 && (
            <label className="field">
              <span className="field__label">Scores from</span>
              <select className="text" value={k.scoreboard ?? ''} onChange={(e) => act({ type: 'updateTitler', id: source.id, titler: { ...k, scoreboard: e.target.value || null } })}>
                <option value="">The first scoreboard</option>
                {scoreboards.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <footer className="modal__foot titler-card__foot">
          <button type="button" className="btn" onClick={() => openTitler(source.id)}>
            Edit in Titler…
          </button>
          <span className="titler-card__grow" />
          <button type="button" className="btn" onClick={next} disabled={onAir} title="Get it ready on the Next monitor">
            Ready in Next
          </button>
          {onAir ? (
            <button type="button" className="btn btn--primary" onClick={out} title="Plays its OUT, then it is off">
              Take OUT
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={take} title={`Plays its IN on the ${screen === 'back' ? 'Back' : 'Live'} Screen, then holds`}>
              Take IN
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
