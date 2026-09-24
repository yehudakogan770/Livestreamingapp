import { useEffect } from 'react';
import type { Show } from '../engine/types/Show';
import type { ScreenId } from '../engine/types/ScreenId';
import './ScreenSelector.css';

export const SCREENS: { id: ScreenId; name: string; where: string; key: string }[] = [
  { id: 'live', name: 'Live Screen', where: 'Stream', key: 'F1' },
  { id: 'back', name: 'Back Screen', where: 'Projector', key: 'F2' },
  { id: 'monitor', name: 'Monitor', where: 'Stage · text', key: 'F3' },
];

type Status = 'on-air' | 'blank' | 'dimmed' | 'idle';

export function screenStatus(show: Show | null, id: ScreenId): Status {
  if (!show) return 'idle';
  const sc = show.screens[id];
  if (show.panic) return id === 'monitor' ? 'dimmed' : 'blank';
  if (sc.blank) return 'blank';
  if (id === 'monitor') return 'on-air';
  return sc.program ? 'on-air' : 'idle';
}

const LABEL: Record<Status, string> = { 'on-air': 'ON AIR', blank: 'BLANK', dimmed: 'DIMMED', idle: 'EMPTY' };

/** Choose which screen you are controlling. The centre of the design; F1–F3 work anywhere. */
export function ScreenSelector({
  show,
  selected,
  onSelect,
}: {
  show: Show | null;
  selected: ScreenId;
  onSelect: (id: ScreenId) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const hit = SCREENS.find((s) => s.key === e.key);
      if (hit && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onSelect(hit.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect]);

  return (
    <div className="selector" role="tablist" aria-label="Screen you are controlling">
      <span className="selector__label">Controlling</span>
      {SCREENS.map((s) => {
        const status = screenStatus(show, s.id);
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={selected === s.id}
            className="selector__tab"
            onClick={() => onSelect(s.id)}
          >
            <span className="selector__name">{s.name}</span>
            <span className="selector__meta">
              <span className={`selector__badge selector__badge--${status}`}>{LABEL[status]}</span>
              {s.where}
              <kbd>{s.key}</kbd>
            </span>
          </button>
        );
      })}
    </div>
  );
}
