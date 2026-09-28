import { useCallback, useMemo, useState } from 'react';
import { createEngineClient } from './engine/client';
import { useShow } from './engine/useShow';
import { outputScreen } from './engine/role';
import type { ScreenId } from './engine/types/ScreenId';
import { TitleBar } from './components/TitleBar';
import { ScreenSelector } from './components/ScreenSelector';
import { ControlView } from './views/ControlView';
import { OutputView } from './views/OutputView';
import { SafeBoundary } from './components/SafeBoundary';
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

  return (
    <div className="app">
      <TitleBar controlling={controlling} />
      <ScreenSelector show={show} selected={controlling} onSelect={select} />
      <main className="workarea">
        {show ? (
          <SafeBoundary audience={false}>
            <ControlView show={show} screen={controlling} client={client} />
          </SafeBoundary>
        ) : (
          <div className="loading">{error ? `The engine did not answer: ${error}` : 'Starting…'}</div>
        )}
      </main>
      {!client.live && (
        <div className="demo-flag" data-testid="engine-status" title="Opened in a browser: changes are not saved">
          browser demo
        </div>
      )}
    </div>
  );
}
