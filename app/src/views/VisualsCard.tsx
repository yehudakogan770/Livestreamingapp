import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import { BANKS, sceneRow } from '../visuals/data';
import { sendCommand } from './commands';
import type { Act } from './act';
import './PesukimCard.css';

/** Stage visuals controls, while the visuals are on air or in Next. */
export function VisualsCard({ show, act, screen }: { show: Show; act: Act; screen: ScreenId }) {
  const sc = show.screens[screen];
  const isVisuals = (id: string | null) => id !== null && show.sources.find((s) => s.id === id)?.kind.type === 'visuals';
  const where = isVisuals(sc.program) ? 'program' : isVisuals(sc.preview) ? 'next' : null;
  if (!where) return null;
  const v = show.visuals;
  const scene = `${BANKS[v.scene.bank]?.name ?? ''} · ${sceneRow(v.scene.bank, v.scene.scene)[0] ?? ''}`;
  const bpm = Math.round(v.bpm);
  return (
    <div className="pk" aria-label="Stage visuals">
      <div className="pk__head">
        <b className={`cd__tag cd__tag--${where}`}>{where === 'next' ? 'NEXT' : 'ON AIR'}</b>
        <span className="pk__where">
          Stage visuals <em>· {scene}</em>
        </span>
        <button type="button" className="btn pk__edit" onClick={() => sendCommand({ type: 'visuals' })}>
          All controls…
        </button>
      </div>
      <div className="pk__row pk__row--main">
        <button type="button" className="btn" onClick={() => act({ type: 'visualsStep', step: -1 })}>
          ◀ Scene
        </button>
        <button type="button" className="btn btn--primary pk__go" onClick={() => act({ type: 'visualsStep', step: 1 })}>
          Next scene ▶
        </button>
      </div>
      <div className="pk__row">
        <button type="button" className="btn" onClick={() => act({ type: 'visualsTempo', bpm: bpm - 1 })} aria-label="Slower beat">
          −
        </button>
        <span className="pk__where">{bpm} BPM</span>
        <button type="button" className="btn" onClick={() => act({ type: 'visualsTempo', bpm: bpm + 1 })} aria-label="Faster beat">
          +
        </button>
        <button type="button" className="btn" onClick={() => act({ type: 'visualsSync' })} title="Press on the beat to line up">
          Sync
        </button>
      </div>
      <div className="pk__row">
        <button type="button" className="btn" onClick={() => act({ type: 'visualsFlash' })}>
          Flash
        </button>
        <button
          type="button"
          className={`btn${v.strobe ? ' is-on' : ''}`}
          aria-pressed={v.strobe}
          onClick={() => act({ type: 'updateVisuals', patch: { strobe: !v.strobe } })}
        >
          Strobe
        </button>
        <button
          type="button"
          className={`btn${v.blackout ? ' is-on' : ''}`}
          aria-pressed={v.blackout}
          onClick={() => act({ type: 'updateVisuals', patch: { blackout: !v.blackout } })}
        >
          {v.blackout ? 'Bring back' : 'To black'}
        </button>
      </div>
    </div>
  );
}
