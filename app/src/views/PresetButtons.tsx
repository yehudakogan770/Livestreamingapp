import type { Show } from '../engine/types/Show';
import { describeStep } from './PresetEditor';
import type { Act } from './act';

/** The picked preset's buttons, above the inputs, and what is running now. */
export function PresetButtons({ show, act, showAll, onShowAll }: { show: Show; act: Act; showAll: boolean; onShowAll: (v: boolean) => void }) {
  const p = show.presets.find((x) => x.id === show.activePreset);
  if (!p && show.running.length === 0) return null;
  return (
    <div className="pbuttons">
      {p && (
        <>
          <span className="pbuttons__label">{p.name}</span>
          {p.buttons.map((b, i) => (
            <button key={i} type="button" className="btn pbuttons__btn" title={b.steps.map((st) => describeStep(st, show)).join('\n') || 'No steps yet'} disabled={b.steps.length === 0} onClick={() => act({ type: 'runSteps', name: b.name, steps: b.steps })}>
              {b.name}
            </button>
          ))}
        </>
      )}
      <span className="grow" />
      {show.running.length > 0 && (
        <span className="pbuttons__running" role="status">
          Running: {show.running.map((r) => r.name).join(', ')}
          <button type="button" className="chip" onClick={() => act({ type: 'stopSteps' })}>Stop</button>
        </span>
      )}
      {p && p.sources.length > 0 && (
        <label className="check pbuttons__all">
          <input type="checkbox" checked={showAll} onChange={(e) => onShowAll(e.target.checked)} /> Show all inputs
        </label>
      )}
    </div>
  );
}
