import { Network, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { joinApi, type FoundShow, type JoinApi, type LinkStatus, type SavedShow } from './api';
import './seats.css';

/**
 * Settings → Join a show on this network…: this computer becomes a seat on
 * another computer's show (the show computer). Find it (or type its
 * address), type the code it shows, and once its operator lets you in the
 * seat window opens.
 */
export function JoinDialog({ onClose, api = joinApi }: { onClose: () => void; api?: JoinApi }) {
  const [status, setStatus] = useState<LinkStatus>({ state: 'idle' });
  const [found, setFound] = useState<FoundShow[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [saved, setSaved] = useState<SavedShow[]>([]);
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const opened = useRef(false);

  const look = useCallback(() => {
    setLooking(true);
    void api
      .discover()
      .then(setFound, () => setFound([]))
      .finally(() => setLooking(false));
  }, [api]);

  useEffect(() => {
    // What the link says from now on wins over the first answer.
    let heard = false;
    const stop = api.onStatus((s) => {
      heard = true;
      setStatus(s);
    });
    void api.status().then(
      (s) => !heard && setStatus(s),
      () => {},
    );
    void api.saved().then(setSaved, () => {});
    void api.computerName().then(
      (n) => setName((cur) => cur || n),
      () => {},
    );
    look();
    return stop;
  }, [api, look]);

  // In: open the seat window (once) and get out of the way.
  useEffect(() => {
    if (status.state !== 'connected' || opened.current) return;
    opened.current = true;
    void api.openWindow().then(onClose, (e: unknown) => setProblem(String(e)));
  }, [status, api, onClose]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const fail = (e: unknown) => setProblem(e instanceof Error ? e.message : String(e));
  const join = (to: string) => {
    setProblem(null);
    setCode('');
    void api.join(to, name).then(setStatus, fail);
  };
  const sendCode = () => {
    setProblem(null);
    void api.code(code).then(setStatus, fail);
  };
  const cancel = () => {
    void api.leave().catch(() => {});
    setStatus({ state: 'idle' });
  };

  const choosing = status.state === 'idle' || status.state === 'ended';
  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Join a show on this network"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal__box remote seats">
        <header className="modal__head">
          <h2>
            <Network className="modal__icon" aria-hidden="true" />
            Join a show on this network
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="remote__body">
          {choosing && (
            <>
              <p className="remote__intro">
                Run part of a show from this computer — graphics, the mixer, replay or cameras — while the show computer runs the cameras, screens and
                recording. On the show computer: Settings → Operators…, then turn on “Let other computers join this show”.
              </p>
              {status.state === 'ended' && (
                <p className="field__note field__note--warn" role="alert">
                  {status.reason}
                </p>
              )}
              {saved.length > 0 && (
                <section className="seats__section" aria-label="Joined before">
                  <h3>Joined before</h3>
                  {saved.map((s) => (
                    <div key={s.showId} className="seats__found">
                      <span className="seats__name">{s.show}</span>
                      <span className="seats__dim">{s.address}</span>
                      <span className="seats__spacer" />
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void api.forget(s.showId).then(setSaved, fail)}
                        title="This computer will need a new code to join that show again"
                      >
                        Forget
                      </button>
                      <button type="button" className="btn btn--primary" onClick={() => void api.rejoin(s.showId).then(onClose, fail)}>
                        Join again
                      </button>
                    </div>
                  ))}
                </section>
              )}
              <section className="seats__section" aria-label="Shows on this network">
                <h3>
                  Shows on this network
                  <button type="button" className="icon seats__refresh" aria-label="Look again" disabled={looking} onClick={look}>
                    <RefreshCw aria-hidden="true" />
                  </button>
                </h3>
                {looking && !found?.length ? (
                  <p className="field__note">Looking…</p>
                ) : found?.length ? (
                  found.map((f) => (
                    <div key={f.id} className="seats__found">
                      <span className="seats__name">{f.name}</span>
                      <span className="seats__dim">{f.address}</span>
                      <span className="seats__spacer" />
                      <button type="button" className="btn btn--primary" onClick={() => join(f.address)}>
                        Join
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="field__note">
                    None found. Check that the show computer lets others join and is on the same network, or type its address below.
                  </p>
                )}
              </section>
              <div className="seats__manual">
                <label className="field">
                  <span className="field__label">Show computer’s address</span>
                  <input
                    type="text"
                    value={address}
                    placeholder="192.168.1.20"
                    spellCheck={false}
                    onChange={(e) => setAddress(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && address.trim() && join(address)}
                  />
                </label>
                <button type="button" className="btn" disabled={!address.trim()} onClick={() => join(address)}>
                  Join
                </button>
              </div>
              <label className="field">
                <span className="field__label">This computer’s name (the show operator sees it)</span>
                <input type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              </label>
            </>
          )}
          {status.state === 'connecting' && <p className="remote__status">Connecting to {status.address}…</p>}
          {status.state === 'enterCode' && (
            <div className="seats__entercode">
              <p className="remote__intro">
                Type the code shown on <strong>{status.show}</strong> (Settings → Operators…).
              </p>
              <input
                className="seats__codefield"
                aria-label="Code"
                inputMode="numeric"
                autoFocus
                maxLength={7}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && sendCode()}
              />
              {status.wrong && (
                <p className="field__note field__note--warn" role="alert">
                  That isn’t the code on the show computer. Check it and type it again.
                </p>
              )}
            </div>
          )}
          {status.state === 'waiting' && (
            <p className="remote__status">
              <span className="remote__dot remote__dot--on" />
              The code is right. Waiting for the show operator at {status.show} to let you in…
            </p>
          )}
          {(status.state === 'connected' || status.state === 'reconnecting') && (
            <p className="remote__status">
              {status.state === 'connected' ? `Connected to ${status.show}.` : `Reconnecting to ${status.show}… ${status.problem}`}
            </p>
          )}
          {problem && (
            <p className="field__note field__note--warn" role="alert">
              {problem}
            </p>
          )}
        </div>
        <footer className="modal__foot">
          {!choosing && (
            <button type="button" className="btn" onClick={cancel}>
              {status.state === 'connected' || status.state === 'reconnecting' ? 'Leave the show' : 'Cancel'}
            </button>
          )}
          <span className="remote__spacer" />
          {status.state === 'enterCode' && (
            <button type="button" className="btn btn--primary" disabled={code.replace(/\D/g, '').length !== 6} onClick={sendCode}>
              Join
            </button>
          )}
          {(status.state === 'connected' || status.state === 'reconnecting') && (
            <button type="button" className="btn btn--primary" onClick={() => void api.openWindow().then(onClose, fail)}>
              Open the seat window
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
