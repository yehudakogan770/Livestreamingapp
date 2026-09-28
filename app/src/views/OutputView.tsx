import { useEffect, useMemo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createEngineClient, isInsideLumora } from '../engine/client';
import type { ScreenId } from '../engine/types/ScreenId';
import { useShow } from '../engine/useShow';
import { FLASH_MS, fadeAmount } from '../engine/timing';
import { useNow } from '../engine/useNow';
import { ProgramView } from '../components/ScreenView';
import { SafeBoundary } from '../components/SafeBoundary';
import './OutputView.css';

/**
 * A full output window: exactly what the audience sees on one screen, with
 * nothing else on it. Double-click toggles fullscreen; Esc leaves it.
 */
export function OutputView({ screen }: { screen: ScreenId }) {
  const client = useMemo(createEngineClient, []);
  const { snapshot } = useShow(client);

  useEffect(() => {
    document.title = `Lumora — ${screen} output`;
    if (!isInsideLumora()) return;
    const w = getCurrentWindow();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void w.setFullscreen(false);
      if (e.key === 'F11') {
        e.preventDefault();
        void w.isFullscreen().then((f) => w.setFullscreen(!f));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  const toggleFull = () => {
    if (!isInsideLumora()) return;
    const w = getCurrentWindow();
    void w.isFullscreen().then((f) => w.setFullscreen(!f));
  };

  const show = snapshot?.show;
  return (
    <div className="output" onDoubleClick={toggleFull}>
      <SafeBoundary audience>
      {show &&
        (screen === 'monitor' ? (
          <MonitorOutput panic={show.panic} panicAt={show.panicChangedAt} blank={show.screens.monitor.blank} blankAt={show.screens.monitor.blankChangedAt} flashAt={show.screens.monitor.flashAt} />
        ) : (
          // Only the Live output plays sound; it is the one that goes to the stream.
          <ProgramView show={show} screen={screen} client={client} audible={screen === 'live'} audience />
        ))}
      </SafeBoundary>
    </div>
  );
}

/** The stage monitor: large, readable text for the people on stage. */
export function MonitorOutput({ panic, panicAt, blank, blankAt, flashAt }: { panic: boolean; panicAt: number; blank: boolean; blankAt: number; flashAt: number }) {
  const flashing = Date.now() - flashAt < FLASH_MS;
  const now = useNow(flashing, 500);
  const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).formatToParts(new Date(now));
  const time = parts.filter((x) => x.type !== 'dayPeriod').map((x) => x.value).join('').trim();
  const period = parts.find((x) => x.type === 'dayPeriod')?.value;
  const dark = Math.max(fadeAmount(blank, blankAt, now), fadeAmount(panic, panicAt, now) * 0.6);
  const flash = now - flashAt < FLASH_MS && Math.floor((now - flashAt) / 300) % 2 === 0;
  return (
    <div className={`monitor${flash ? ' monitor--flash' : ''}`}>
      <div className="monitor__clock">
        {time}
        {period && <small>{period}</small>}
      </div>
      <div className="monitor__hint">Messages and the countdown come here next.</div>
      {dark > 0 && <div className="monitor__dark" style={{ opacity: dark }} />}
    </div>
  );
}
