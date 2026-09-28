import { useCallback, useMemo, useState } from 'react';
import { createEngineClient } from './engine/client';
import { useShow } from './engine/useShow';
import { outputScreen } from './engine/role';
import type { ScreenId } from './engine/types/ScreenId';
import { TitleBar } from './components/TitleBar';
import { ScreenSelector } from './components/ScreenSelector';
import { ControlView } from './views/ControlView';
import { OutputView } from './views/OutputView';
import { EventSetup } from './views/EventSetup';
import { SafeBoundary } from './components/SafeBoundary';
import { SoundProvider } from './audio/SoundContext';
import { StageContext } from './engine/CountdownContext';
import './App.css';

export function App() {
  const output = useMemo(outputScreen, []);
  return output ? <OutputView screen={output} /> : <Control />;
}

function Control() {
  const client = useMemo(createEngineClient, []);
  const { snapshot, error } = useShow(client);
  const [controlling, setControlling] = useState<ScreenId>('live');
  const select = useCallback((id: ScreenId) => setControlling(id), []);
  const show = snapshot?.show ?? null;
  // The event setup opens by itself until it has been answered once, and from the Event menu.
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const showSetup = !!show && (setupOpen || (!show.event.setUp && !setupDismissed));
  const closeSetup = useCallback(() => {
    setSetupOpen(false);
    setSetupDismissed(true);
  }, []);
  const menu = useMemo(() => ({ Event: () => setSetupOpen(true) }), []);

  return (
    <div className="app">
      <TitleBar controlling={controlling} eventName={show?.event.name} actions={menu} />
      <ScreenSelector show={show} selected={controlling} onSelect={select} />
      <main className="workarea">
        {show ? (
          <SafeBoundary audience={false}>
            <SoundProvider show={show} client={client}>
              <StageContext.Provider value={{ countdown: show.countdown, event: show.event, mediaUrl: (p) => client.mediaUrl(p) }}>
                <ControlView show={show} screen={controlling} client={client} />
              </StageContext.Provider>
            </SoundProvider>
          </SafeBoundary>
        ) : (
          <div className="loading">{error ? `The engine did not answer: ${error}` : 'Starting…'}</div>
        )}
      </main>
      {showSetup && show && (
        <StageContext.Provider value={{ countdown: show.countdown, event: show.event, mediaUrl: (p) => client.mediaUrl(p) }}>
          <EventSetup show={show} client={client} onClose={closeSetup} onError={(e) => console.error('Lumora: event setup', e)} />
        </StageContext.Provider>
      )}
      {!client.live && (
        <div className="demo-flag" data-testid="engine-status" title="Opened in a browser: changes are not saved">
          browser demo
        </div>
      )}
    </div>
  );
}
