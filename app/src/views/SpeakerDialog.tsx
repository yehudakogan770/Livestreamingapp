import { Presentation, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EngineClient, RemoteStatus } from '../engine/client';
import './RemoteDialog.css';
import './SpeakerDialog.css';

/**
 * Give the speaker a clicker: a QR code, a short link and the speaker PIN
 * for the slides page (src-tauri/remote/slides.html). The speaker's device
 * can only change slides; the operator can pause it or disconnect it.
 */
export function SpeakerDialog({
  client,
  status,
  clicker,
  onClicker,
  onClose,
}: {
  client: EngineClient;
  status: RemoteStatus;
  /** Settings → "Presentation clicker controls the slideshow". */
  clicker: boolean;
  onClicker: (on: boolean) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const run = (p: Promise<RemoteStatus>) => {
    setBusy(true);
    setProblem(null);
    void p.catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
  };
  const sp = status.speaker;
  const address = status.addresses[Math.min(shown, status.addresses.length - 1)];
  const devices = sp?.devices ?? [];
  const speakers = devices.filter((d) => d.speaker);
  const followers = devices.filter((d) => !d.speaker);

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Let the speaker change slides"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal__box remote spk">
        <header className="modal__head">
          <h2>
            <Presentation className="modal__icon" aria-hidden="true" />
            Let the speaker change slides
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="remote__body">
          <p className="remote__intro">
            Give the speaker a clicker: their phone, tablet or laptop shows the slide, the next one and the notes, and changes the slides — nothing else. It
            can’t switch cameras or go live. You can pause it at any time, and whatever you do here always wins.
          </p>
          {!client.live && <p className="field__note field__note--warn">This works in the Lumora app, not in the browser demo.</p>}

          {!status.running ? (
            <div className="spk__off">
              <p className="field__note">The speaker connects through the phone remote, which is off.</p>
              {status.enabled && status.error && (
                <p className="field__note field__note--warn" role="alert">
                  {status.error}
                </p>
              )}
              <button type="button" className="btn btn--primary" disabled={busy || !client.live} onClick={() => run(client.setRemote(true))}>
                Turn on the phone remote
              </button>
            </div>
          ) : address && sp ? (
            <>
              <div className="remote__connect">
                <img
                  className="remote__qr"
                  alt={`QR code for ${address.slidesUrl ?? `${address.url}/slides`}`}
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(address.slidesQr ?? address.qr)}`}
                />
                <ol className="remote__steps">
                  <li>
                    Connect the speaker’s device to the <strong>same Wi-Fi</strong> as this computer.
                  </li>
                  <li>
                    Point its camera at the code (it connects by itself), or open:
                    <span className="remote__url" data-testid="speaker-url">
                      {address.slidesUrl ?? `${address.url}/slides`}
                    </span>
                  </li>
                  <li>
                    If it asks, type the speaker PIN:{' '}
                    <span className="remote__pin" data-testid="speaker-pin">
                      {sp.pin}
                    </span>
                  </li>
                </ol>
              </div>
              {status.addresses.length > 1 && (
                <div className="remote__others">
                  This computer is on more than one network. If the device can’t connect, try:
                  {status.addresses.map((a, i) => (
                    <button key={a.url} type="button" className={`btn${i === shown ? ' btn--on' : ''}`} onClick={() => setShown(i)}>
                      {a.url.replace('http://', '')}
                    </button>
                  ))}
                </div>
              )}

              <div className="spk__who" aria-live="polite">
                {speakers.length === 0 && followers.length === 0 && (
                  <p className="remote__status">
                    <span className="remote__dot" />
                    No speaker connected yet
                  </p>
                )}
                {speakers.map((d) => (
                  <div key={d.id} className="spk__device">
                    <span className={`remote__dot${sp.locked ? '' : ' remote__dot--on'}`} />
                    <span className="spk__name">
                      {sp.locked ? `Speaker is connected, control paused (${d.device})` : `Speaker is controlling slides (${d.device})`}
                    </span>
                    <button type="button" className="btn btn--small" disabled={busy} onClick={() => run(client.disconnectSpeaker(d.id))}>
                      Disconnect
                    </button>
                  </div>
                ))}
                {followers.map((d) => (
                  <div key={d.id} className="spk__device">
                    <span className="remote__dot remote__dot--on" />
                    <span className="spk__name">Slides open with the phone remote PIN ({d.device})</span>
                  </div>
                ))}
              </div>

              <div className="spk__controls">
                <button
                  type="button"
                  className={`btn spk__lock${sp.locked ? ' btn--primary' : ''}`}
                  disabled={busy}
                  aria-pressed={sp.locked}
                  onClick={() => run(client.setSpeaker({ locked: !sp.locked }))}
                >
                  {sp.locked ? 'Let the speaker change slides again' : 'Pause speaker control'}
                </button>
                {sp.locked && <span className="field__note field__note--warn">Paused: the speaker sees the slides but can’t change them.</span>}
                <label className="check">
                  <input type="checkbox" checked={sp.black} disabled={busy} onChange={(e) => run(client.setSpeaker({ black: e.target.checked }))} /> The speaker
                  may black out the slides (Black screen button, or B on a clicker)
                </label>
              </div>
            </>
          ) : (
            <p className="field__note field__note--warn">
              This computer is not connected to a network, so the speaker’s device can’t reach it. Connect it to the venue’s Wi-Fi or router.
            </p>
          )}

          <label className="check spk__clicker">
            <input type="checkbox" checked={clicker} onChange={(e) => onClicker(e.target.checked)} /> Presentation clicker controls the slideshow (a clicker
            plugged into this computer: Page Down, Page Up, B)
          </label>
          {problem && (
            <p className="field__note field__note--warn" role="alert">
              {problem}
            </p>
          )}
        </div>
        <footer className="modal__foot">
          {status.running && sp && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => run(client.newSpeakerPin())}
              title="The speaker’s devices have to connect again with the new PIN"
            >
              New speaker PIN
            </button>
          )}
          <span className="remote__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
