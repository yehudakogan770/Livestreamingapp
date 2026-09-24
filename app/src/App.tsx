import { useCallback, useMemo, useState } from 'react';
import { createEngineClient } from './engine/client';
import { useShow } from './engine/useShow';
import type { ScreenId } from './engine/types/ScreenId';
import { TitleBar } from './components/TitleBar';
import { ScreenSelector } from './components/ScreenSelector';
import { LogoMark } from './components/Logo';
import './App.css';

export function App() {
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
        <div className="welcome">
          <LogoMark size={96} lit={controlling} />
          <h1>Lumora</h1>
          <p>Foundation is running. Preview, program and inputs arrive in the next milestones.</p>
          <dl className="welcome__facts">
            <dt>Engine</dt>
            <dd data-testid="engine-status">
              {error ? `error: ${error}` : !snapshot ? 'connecting…' : client.live ? 'connected' : 'browser preview (not running inside Lumora)'}
            </dd>
            <dt>Show revision</dt>
            <dd>{snapshot?.revision ?? '—'}</dd>
            <dt>Sources</dt>
            <dd>{show?.sources.length ?? '—'}</dd>
            <dt>TAKE transition</dt>
            <dd>{show ? `${show.transition.kind} · ${show.transition.durationMs} ms` : '—'}</dd>
          </dl>
        </div>
      </main>
      <footer className="statusbar">
        <span>Lumora 0.1.0 · milestone 1</span>
        <span>F1 Live · F2 Back · F3 Monitor</span>
      </footer>
    </div>
  );
}
