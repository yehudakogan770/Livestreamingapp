import { useEffect, useMemo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createEngineClient, isInsideLumora } from '../engine/client';
import type { ScreenId } from '../engine/types/ScreenId';
import { useShow } from '../engine/useShow';
import { MonitorScreen } from '../components/MonitorScreen';
import { ProgramView } from '../components/ScreenView';
import { SafeBoundary } from '../components/SafeBoundary';
import { StageContext } from '../engine/CountdownContext';
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
        <StageContext.Provider value={show ? { event: show.event, mediaUrl: (p) => client.mediaUrl(p) } : null}>
        {show &&
          (screen === 'monitor' ? (
            <MonitorScreen show={show} />
          ) : (
            // Only the Live output plays sound; it is the one that goes to the stream.
            <ProgramView show={show} screen={screen} client={client} audience />
          ))}
        </StageContext.Provider>
      </SafeBoundary>
    </div>
  );
}
