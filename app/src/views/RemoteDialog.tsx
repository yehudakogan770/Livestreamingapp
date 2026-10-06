import { Smartphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EngineClient, RemoteStatus } from '../engine/client';
import './RemoteDialog.css';

/** Switch the phone remote on, and show the address, QR code and PIN. */
export function RemoteDialog({ client, status, onClose }: { client: EngineClient; status: RemoteStatus; onClose: () => void }) {
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
  const address = status.addresses[Math.min(shown, status.addresses.length - 1)];

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Phone remote" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box remote">
        <header className="modal__head">
          <h2>
            <Smartphone className="modal__icon" aria-hidden="true" />
            Phone remote
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="remote__body">
          <p className="remote__intro">
            Run the show from a phone or tablet: Next and TAKE, presets, the countdown, stage messages and PANIC. Phones can’t delete or change inputs or
            settings.
          </p>
          {!client.live && <p className="field__note field__note--warn">The phone remote works in the Lumora app, not in the browser demo.</p>}

          {status.running ? (
            <>
              {address ? (
                <div className="remote__connect">
                  <img className="remote__qr" alt={`QR code for ${address.url}`} src={`data:image/svg+xml;utf8,${encodeURIComponent(address.qr)}`} />
                  <ol className="remote__steps">
                    <li>
                      Connect the phone to the <strong>same Wi-Fi</strong> as this computer.
                    </li>
                    <li>
                      Point the phone’s camera at the code, or type the address:
                      <span className="remote__url" data-testid="remote-url">
                        {address.url}
                      </span>
                    </li>
                    <li>
                      Type the PIN:{' '}
                      <span className="remote__pin" data-testid="remote-pin">
                        {status.pin}
                      </span>
                    </li>
                  </ol>
                </div>
              ) : (
                <p className="field__note field__note--warn">
                  This computer is not connected to a network, so phones can’t reach it. Connect it to the venue’s Wi-Fi or router.
                </p>
              )}
              {status.addresses.length > 1 && (
                <div className="remote__others">
                  This computer is on more than one network. If the phone can’t connect, try:
                  {status.addresses.map((a, i) => (
                    <button key={a.url} type="button" className={`btn${i === shown ? ' btn--on' : ''}`} onClick={() => setShown(i)}>
                      {a.url.replace('http://', '')}
                    </button>
                  ))}
                </div>
              )}
              <p className="remote__status">
                <span className={`remote__dot${status.phones > 0 ? ' remote__dot--on' : ''}`} />
                {status.phones === 0 ? 'No phones connected yet' : status.phones === 1 ? '1 phone connected' : `${status.phones} phones connected`}
              </p>
              <p className="field__note">
                If Windows asks whether to allow Lumora on the network, choose <strong>Allow access</strong>.
              </p>
              {address && <ControlHelp base={address.url.replace(/\/$/, '')} pin={status.pin} />}
            </>
          ) : (
            status.enabled &&
            status.error && (
              <p className="field__note field__note--warn" role="alert">
                {status.error}
              </p>
            )
          )}
          {problem && (
            <p className="field__note field__note--warn" role="alert">
              {problem}
            </p>
          )}
        </div>
        <footer className="modal__foot">
          {status.running && (
            <button type="button" className="btn" disabled={busy} onClick={() => run(client.newRemotePin())} title="Every phone has to type the new PIN">
              New PIN
            </button>
          )}
          <span className="remote__spacer" />
          {status.enabled ? (
            <button type="button" className="btn" disabled={busy} onClick={() => run(client.setRemote(false))}>
              Turn off
            </button>
          ) : (
            <button type="button" className="btn btn--primary" disabled={busy || !client.live} onClick={() => run(client.setRemote(true))}>
              Turn on the phone remote
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

const EXAMPLES: [string, string][] = [
  ['TAKE (Live)', 'take?screen=live'],
  ['CUT', 'cut'],
  ['Input 3 to Next', 'preview?input=3'],
  ['Input 3 straight to air', 'cutto?input=3'],
  ['TAKE with a wipe', 'take?transition=wipe&ms=800'],
  ['Overlay 1 on / off', 'overlay?channel=1&state=toggle'],
  ['Blank Live on / off', 'blank?screen=live'],
  ['Fade to black', 'ftb?screen=live'],
  ['Next cue', 'nextcue'],
  ['Play / pause input 2', 'playpause?input=2'],
  ['Playlist on input 2: next video', 'playlist?input=2&item=next'],
  ['Next slide on input 4', 'slide?input=4&to=next'],
  ['PANIC on / off', 'panic'],
];

/** Addresses for Stream Deck (Companion), tally lights and scripts. */
function ControlHelp({ base, pin }: { base: string; pin: string }) {
  const [open, setOpen] = useState(false);
  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});
  return (
    <details className="remote__api" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Stream Deck, Companion and tally lights</summary>
      <p className="field__note">
        In Bitfocus Companion use the “Generic HTTP” connection (or a Stream Deck “web request” button) with these addresses. Tally lights read{' '}
        <code>{`${base}/api/tally?pin=${pin}`}</code>.
      </p>
      <table className="remote__apitable">
        <tbody>
          {EXAMPLES.map(([what, cmd]) => {
            const url = `${base}/api/do/${cmd}${cmd.includes('?') ? '&' : '?'}pin=${pin}`;
            return (
              <tr key={cmd}>
                <td>{what}</td>
                <td>
                  <code>{url}</code>
                </td>
                <td>
                  <button type="button" className="btn btn--small" onClick={() => copy(url)} aria-label={`Copy address for ${what}`}>
                    Copy
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="field__note">Inputs can also be named: name=Camera 1. Screens: live or back. States: on, off or toggle.</p>
    </details>
  );
}
