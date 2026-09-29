import { useEffect, useState } from 'react';
import type { ScreenId } from '../engine/types/ScreenId';
import { LogoMark } from './Logo';
import './TitleBar.css';

const MENUS = ['Event', 'Presets', 'Cues', 'Library', 'Inputs', 'Overlays', 'Text', 'Slideshow', '12 Pesukim', 'Timer', 'Visuals', 'Settings', 'Help'];

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** One entry of a drop-down menu (null draws a divider). */
export type MenuItem = { label: string; onClick: () => void; disabled?: boolean; hint?: string } | null;

/**
 * The top bar. Menus with items or an action are live; the rest arrive in
 * later milestones. The event's name shows beside the clock.
 */
export function TitleBar({
  controlling,
  eventName,
  actions = {},
  menus = {},
}: {
  controlling: ScreenId;
  eventName?: string;
  actions?: Partial<Record<string, () => void>>;
  menus?: Partial<Record<string, MenuItem[]>>;
}) {
  const clock = useClock();
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !(e.target as HTMLElement).closest('.titlebar__drop, .titlebar__item') && setOpen(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <LogoMark size={18} lit={controlling} />
        <span className="titlebar__name">Lumora</span>
      </div>
      <nav className="titlebar__menu" aria-label="Main menu">
        {MENUS.map((m) => {
          const items = menus[m];
          const action = actions[m];
          return (
            <span key={m} className="titlebar__slot">
              <button
                type="button"
                className={`titlebar__item${open === m ? ' is-open' : ''}`}
                disabled={!items && !action}
                aria-haspopup={items ? 'menu' : undefined}
                aria-expanded={items ? open === m : undefined}
                title={items || action ? undefined : 'Coming in a later milestone'}
                onClick={() => (items ? setOpen(open === m ? null : m) : action?.())}
              >
                {m}
              </button>
              {items && open === m && (
                <div className="titlebar__drop" role="menu" aria-label={m}>
                  {items.map((it, i) =>
                    it === null ? (
                      <hr key={i} />
                    ) : (
                      <button
                        key={i}
                        type="button"
                        role="menuitem"
                        disabled={it.disabled}
                        title={it.hint}
                        onClick={() => {
                          setOpen(null);
                          it.onClick();
                        }}
                      >
                        {it.label}
                      </button>
                    ),
                  )}
                </div>
              )}
            </span>
          );
        })}
      </nav>
      {eventName && <span className="titlebar__event">{eventName}</span>}
      <span className="titlebar__clock" aria-label="Current time">
        {clock}
      </span>
    </header>
  );
}
