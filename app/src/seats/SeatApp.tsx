// The seat window: this computer runs part of another computer's show
// (Settings → Join a show on this network…). Everything here goes to the
// show computer, which checks it against this seat's role; the pictures are
// small copies it sends a few times a second.

import { Circle, LogOut, Radio, Rewind, Wifi, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gate } from '../auth/Gate';
import { BrandMark } from '../components/Logo';
import type { Action } from '../engine/types/Action';
import type { ScreenId } from '../engine/types/ScreenId';
import { seatApi, seatLine, type LinkStatus, type PtzMove, type SeatApi, type SeatCommand, type SeatDocument } from './api';
import { roleName } from './roles';
import { AudioPanel, CamerasPanel, GraphicsPanel } from './SeatPanels';
import { SeatCtx, SeatGate, canDo, useSeat, useSeatPicture, type Seat } from './seatContext';
import '../views/ControlView.css';
import '../styles.css';
import './seats.css';

/** Pictures of inputs: the first few with a picture. */
const MAX_INPUT_PICTURES = 12;
const PICTURED = new Set(['camera', 'video', 'image', 'stream', 'guest', 'screen', 'browser', 'slideshow']);

/** The keys this seat asks the show computer for. */
export function watchKeys(doc: SeatDocument | null, screen: ScreenId, meters: boolean): string[] {
  const keys = [`program/${screen}`, `next/${screen}`];
  for (const s of (doc?.show.sources ?? []).filter((x) => PICTURED.has(x.kind.type)).slice(0, MAX_INPUT_PICTURES)) keys.push(`source/${s.id}`);
  if (meters) keys.push('meters');
  return keys;
}

/** The bar at the top: which show, as what, and Leave. */
export function SeatBar({ status, onLeave }: { status: LinkStatus; onLeave: () => void }) {
  const ok = status.state === 'connected';
  const text = seatLine(status, roleName);
  return (
    <header className={`seat-bar${ok ? '' : ' seat-bar--warn'}`} role="banner">
      <BrandMark size={20} />
      {ok ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
      <span className="seat-bar__text" data-testid="seat-line">
        {text}
      </span>
      {status.state === 'reconnecting' && <span className="seat-bar__dim">{status.problem}</span>}
      {ok && status.rttMs !== null && (
        <span className="seat-bar__dim" title="Round trip to the show computer">
          {status.rttMs} ms
        </span>
      )}
      <span className="seat-bar__spacer" />
      <button type="button" className="btn" onClick={onLeave}>
        <LogOut aria-hidden="true" />
        Leave
      </button>
    </header>
  );
}

function Picture({ api, pictureKey, label }: { api: SeatApi; pictureKey: string; label: string }) {
  const url = useSeatPicture(api, pictureKey);
  return <div className="seat-pic">{url ? <img src={url} alt={label} draggable={false} /> : <span className="seat-pic__none">No picture yet</span>}</div>;
}

function Monitors({ doc, screen }: { doc: SeatDocument; screen: ScreenId }) {
  const { api, act } = useSeat();
  const sc = doc.show.screens[screen];
  const name = (id: string | null) => doc.show.sources.find((s) => s.id === id)?.name ?? 'nothing';
  return (
    <div className="seat-mons">
      <div className="seat-mon seat-mon--pvw">
        <Picture api={api} pictureKey={`next/${screen}`} label="Next" />
        <div className="seat-mon__label">
          <span className="seat-mon__tally">NEXT</span> {name(sc.preview)}
        </div>
      </div>
      <SeatGate group="switching" className="seat-switch">
        <button type="button" className="btn btn--big" onClick={() => act({ type: 'take', screen })} disabled={!sc.preview}>
          TAKE
        </button>
        <button type="button" className="btn" onClick={() => act({ type: 'take', screen, transition: 'cut' })} disabled={!sc.preview}>
          CUT
        </button>
        <button type="button" className="btn" onClick={() => act({ type: 'fadeToBlack', screen })}>
          {sc.blank ? 'Back from black' : 'Fade to black'}
        </button>
      </SeatGate>
      <div className="seat-mon seat-mon--pgm">
        <Picture api={api} pictureKey={`program/${screen}`} label="On air" />
        <div className="seat-mon__label">
          <span className="seat-mon__tally">ON AIR</span> {name(sc.program)}
        </div>
      </div>
    </div>
  );
}

function Inputs({ doc, screen }: { doc: SeatDocument; screen: ScreenId }) {
  const { api, act } = useSeat();
  const sc = doc.show.screens[screen];
  const pictured = new Set(watchKeys(doc, screen, false));
  return (
    <SeatGate group="preview" className="seat-inputs">
      {doc.show.sources.map((s, i) => (
        <button
          key={s.id}
          type="button"
          className={`seat-tile${sc.program === s.id ? ' is-pgm' : ''}${sc.preview === s.id ? ' is-pvw' : ''}`}
          onClick={() => act({ type: 'setPreview', screen, sourceId: s.id })}
          title={`Line up “${s.name}” in Next`}
        >
          {pictured.has(`source/${s.id}`) ? (
            <Picture api={api} pictureKey={`source/${s.id}`} label={s.name} />
          ) : (
            <span className="seat-tile__kind">{s.kind.type}</span>
          )}
          <span className="seat-tile__name">
            {i + 1}. {s.name}
          </span>
        </button>
      ))}
    </SeatGate>
  );
}

function GoingOut({ doc }: { doc: SeatDocument }) {
  const { command } = useSeat();
  const app = doc.app ?? {};
  return (
    <div className="seat-out">
      <SeatGate group="recording" className="seat-out__group">
        <button
          type="button"
          className={`btn${app.recording ? ' is-on seat-rec' : ''}`}
          aria-pressed={!!app.recording}
          onClick={() => command({ command: 'record', on: !app.recording })}
        >
          <Circle aria-hidden="true" />
          {app.recording ? 'Stop recording' : 'REC'}
        </button>
        <button
          type="button"
          className={`btn${app.streaming ? ' is-on seat-rec' : ''}`}
          aria-pressed={!!app.streaming}
          onClick={() => command({ command: 'stream', on: !app.streaming })}
        >
          <Radio aria-hidden="true" />
          {app.streaming ? 'End the stream' : 'GO LIVE'}
        </button>
      </SeatGate>
      <SeatGate group="replay" className="seat-out__group">
        <button
          type="button"
          className={`btn${app.replay ? ' is-on' : ''}`}
          aria-pressed={!!app.replay}
          onClick={() => command({ command: 'replayBuffer', on: !app.replay })}
        >
          {app.replay ? 'Keeping the last minute' : 'Keep the last minute'}
        </button>
        {[5, 10, 20].map((s) => (
          <button key={s} type="button" className="btn" disabled={!app.replay} onClick={() => command({ command: 'replay', seconds: s })}>
            <Rewind aria-hidden="true" />
            {s} s
          </button>
        ))}
        <button type="button" className="btn" disabled={!app.replay} onClick={() => command({ command: 'replay', seconds: 10, slow: true })}>
          10 s slow
        </button>
      </SeatGate>
    </div>
  );
}

type Tab = 'graphics' | 'audio' | 'cameras';

/** The seat window's content (given its link, for tests). */
export function SeatView({ api, onLeave }: { api: SeatApi; onLeave: () => void }) {
  const [status, setStatus] = useState<LinkStatus>({ state: 'connecting', address: '' });
  const [doc, setDoc] = useState<SeatDocument | null>(null);
  const [meters, setMeters] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [screen, setScreen] = useState<ScreenId>('live');
  const [tab, setTab] = useState<Tab | null>(null);

  useEffect(() => {
    // What the link says from now on wins over the first answers.
    let heardStatus = false;
    let heardDoc = false;
    const stops = [
      api.onStatus((s) => {
        heardStatus = true;
        setStatus(s);
      }),
      api.onDocument((d) => {
        heardDoc = true;
        setDoc(d);
      }),
      api.onMeters(setMeters),
    ];
    void api.status().then(
      (s) => !heardStatus && setStatus(s),
      () => {},
    );
    void api.document().then(
      (d) => d && !heardDoc && setDoc(d),
      () => {},
    );
    return () => stops.forEach((s) => s());
  }, [api]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const connected = status.state === 'connected';
  const role = connected ? status.seat.role : null;
  const locked = connected && status.seat.locked;
  const fail = useCallback((e: unknown) => setNotice(e instanceof Error ? e.message : String(e)), []);
  const seat = useMemo<Seat>(
    () => ({
      role,
      locked,
      connected,
      can: (g) => canDo(role, locked, connected, g),
      act: (a: Action) => void api.action(a).catch(fail),
      command: (c: SeatCommand) => void api.command(c).catch(fail),
      ptz: (source: string, move: PtzMove) => void api.ptz(source, move).catch(fail),
      api,
    }),
    [api, role, locked, connected, fail],
  );
  // The panel that fits the role opens first.
  const shownTab: Tab = tab ?? (role?.kind === 'audio' ? 'audio' : role?.kind === 'cameras' ? 'cameras' : 'graphics');
  const wantMeters = shownTab === 'audio';
  const keys = watchKeys(doc, screen, wantMeters).join('|');
  useEffect(() => {
    if (connected) void api.watchKeys(keys.split('|')).catch(() => {});
  }, [api, keys, connected]);

  return (
    <SeatCtx.Provider value={seat}>
      <div className="seat-app">
        <SeatBar status={status} onLeave={onLeave} />
        {!doc ? (
          <div className="loading">
            <BrandMark size={40} />
            <span>{status.state === 'ended' ? status.reason : 'Getting the show…'}</span>
          </div>
        ) : (
          <main className="seat-main">
            <nav className="seat-screens" aria-label="Screen">
              {(['live', 'back'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`seat-screens__tab${screen === s ? ' is-on' : ''}`}
                  aria-pressed={screen === s}
                  onClick={() => setScreen(s)}
                >
                  {s === 'live' ? 'Live Screen' : 'Back Screen'}
                </button>
              ))}
              <span className="seat-bar__spacer" />
              <GoingOut doc={doc} />
            </nav>
            <Monitors doc={doc} screen={screen} />
            <Inputs doc={doc} screen={screen} />
            <div className="seat-tabs" role="tablist">
              {(
                [
                  ['graphics', 'Graphics'],
                  ['audio', 'Audio'],
                  ['cameras', 'Cameras'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={shownTab === id}
                  className={`seat-tabs__tab${shownTab === id ? ' is-on' : ''}`}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="seat-body">
              {shownTab === 'graphics' && <GraphicsPanel show={doc.show} />}
              {shownTab === 'audio' && <AudioPanel show={doc.show} meters={meters} />}
              {shownTab === 'cameras' && <CamerasPanel show={doc.show} />}
            </div>
          </main>
        )}
        {notice && (
          <div className="app-notice" role="status">
            {notice}
          </div>
        )}
      </div>
    </SeatCtx.Provider>
  );
}

/** The seat window, behind Lumora's sign-in like the control window. */
export function SeatWindow() {
  return (
    <Gate product="lumora">
      <SeatApp />
    </Gate>
  );
}

function SeatApp() {
  const leave = useCallback(() => {
    void seatApi
      .leave()
      .catch(() => {})
      .finally(() => {
        void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().close()).catch(() => {});
      });
  }, []);
  return <SeatView api={seatApi} onLeave={leave} />;
}
