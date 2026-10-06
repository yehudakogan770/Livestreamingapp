import { useEventFonts } from '../engine/fonts';
import { setSetLook } from '../visuals/sets';
import { useEffect, useMemo } from 'react';
import { dataValues } from '../engine/data';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createEngineClient, isInsideLumora } from '../engine/client';
import type { ScreenId } from '../engine/types/ScreenId';
import { useShow } from '../engine/useShow';
import { MonitorScreen } from '../components/MonitorScreen';
import { ProgramView } from '../components/ScreenView';
import { SafeBoundary } from '../components/SafeBoundary';
import { StageContext } from '../engine/CountdownContext';
import { useTestProbe } from '../testevent/outputProbe';
import './OutputView.css';

/**
 * A full output window: exactly what the audience sees on one screen, with
 * nothing else on it. Double-click toggles fullscreen; Esc leaves it.
 */
export function OutputView({ screen }: { screen: ScreenId }) {
  const client = useMemo(createEngineClient, []);
  const { snapshot } = useShow(client);
  // Answers the test event (Settings → Run a test event…) when it checks this output.
  useTestProbe(screen, snapshot?.show);
  useEventFonts(snapshot?.show.event.brand.fonts, client);
  // Virtual sets follow the event's look.
  setSetLook(snapshot?.show.event.brand.accent ?? '#2f80ed', snapshot?.show.event.name ?? '');

  useEffect(() => {
    document.title = `Lumora — ${screen} output`;
    // The stage monitor is only for the crew to talk to the stage: nothing
    // there (a tap, a key) changes it. The crew opens and closes it in Outputs.
    if (!isInsideLumora() || screen === 'monitor') return;
    const w = getCurrentWindow();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void w.setFullscreen(false);
      if (e.key === 'F11' && !e.repeat) {
        e.preventDefault();
        void w.isFullscreen().then((f) => w.setFullscreen(!f));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  const toggleFull = () => {
    if (!isInsideLumora() || screen === 'monitor') return;
    const w = getCurrentWindow();
    void w.isFullscreen().then((f) => w.setFullscreen(!f));
  };

  const show = snapshot?.show;
  return (
    <div className="output" onDoubleClick={toggleFull}>
      <SafeBoundary audience>
        <StageContext.Provider
          value={
            show
              ? {
                  event: show.event,
                  mediaUrl: (p) => client.mediaUrl(p),
                  sources: show.sources,
                  visuals: show.visuals,
                  data: dataValues(show.data),
                  screens: show.screens,
                }
              : null
          }
        >
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
