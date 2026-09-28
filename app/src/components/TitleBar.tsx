import { useEffect, useState } from 'react';
import type { ScreenId } from '../engine/types/ScreenId';
import { LogoMark } from './Logo';
import './TitleBar.css';

const MENUS = ['Event', 'Presets', 'Cues', 'Library', 'Inputs', 'Overlays', 'Text', 'Slideshow', '12 Pesukim', 'Timer', 'Settings', 'Help'];

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/**
 * The top bar. Menus with an action are live; the rest arrive in later
 * milestones. The event's name shows beside the clock.
 */
export function TitleBar({ controlling, eventName, actions = {} }: { controlling: ScreenId; eventName?: string; actions?: Partial<Record<string, () => void>> }) {
  const clock = useClock();
  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <LogoMark size={18} lit={controlling} />
        <span className="titlebar__name">Lumora</span>
      </div>
      <nav className="titlebar__menu" aria-label="Main menu">
        {MENUS.map((m) => (
          <button key={m} type="button" className="titlebar__item" disabled={!actions[m]} title={actions[m] ? undefined : 'Coming in a later milestone'} onClick={actions[m]}>
            {m}
          </button>
        ))}
      </nav>
      {eventName && <span className="titlebar__event">{eventName}</span>}
      <span className="titlebar__clock" aria-label="Current time">
        {clock}
      </span>
    </header>
  );
}
