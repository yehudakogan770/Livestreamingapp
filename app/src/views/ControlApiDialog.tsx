import { Cable, Copy, Eye, EyeOff, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiStatus, cleanPort, configOf, examples, newApiToken, setApi, type ApiConfig, type ApiStatus } from '../control/api';
import './ControlApiDialog.css';

/** A port box that only saves a usable port. */
function PortBox({ label, value, onSave }: { label: string; value: number; onSave: (port: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const port = cleanPort(text);
  return (
    <label className="field capi__port">
      <span className="field__label">{label}</span>
      <input
        className="text"
        inputMode="numeric"
        value={text}
        aria-label={label}
        aria-invalid={port === null}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => (port !== null && port !== value ? onSave(port) : setText(String(value)))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

/** The control API: Companion (Stream Deck, X-keys), tally lights, OSC and scripts. */
export function ControlApiDialog({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<ApiStatus | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState('');
  const [confirmNew, setConfirmNew] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () => void apiStatus().then((s) => live && setSt(s), () => {});
    read();
    // The number of connected clients changes by itself.
    const id = setInterval(read, 3000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const save = (p: Partial<ApiConfig>) => st && void setApi({ ...configOf(st), ...p }).then(setSt, () => {});
  const copy = (what: string, text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? '' : c)), 2000);
  };
  const base = st?.addresses[0] ?? `http://this-computer:${st?.port ?? 8095}`;
  const ws = base.replace(/^http/, 'ws');

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Control API" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box capi">
        <header className="modal__head">
          <h2>
            <Cable className="modal__icon" aria-hidden="true" />
            Control API
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        {!st ? (
          <p className="field__note capi__body">Loading…</p>
        ) : (
          <div className="capi__body">
            <p className="field__note">
              Let Bitfocus Companion (Stream Deck, X-keys, Loupedeck), tally lights, show-control systems and your own scripts run Lumora: switch, overlays,
              recording, streaming, replays, slides, macros and the countdown, and read which input is on air.
            </p>

            <section className="capi__section" aria-label="HTTP and WebSocket">
              <label className="check capi__switch">
                <input type="checkbox" checked={st.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> HTTP and WebSocket
              </label>
              <span className={`capi__state${st.running ? ' is-on' : ''}`} role="status">
                {st.running ? `Listening${st.clients ? ` · ${st.clients} connected` : ''}` : 'Off'}
              </span>
              <PortBox label="Port" value={st.port} onSave={(port) => save({ port })} />
            </section>

            <section className="capi__section" aria-label="OSC">
              <label className="check capi__switch">
                <input type="checkbox" checked={st.osc} onChange={(e) => save({ osc: e.target.checked })} /> OSC (UDP)
              </label>
              <span className={`capi__state${st.oscRunning ? ' is-on' : ''}`}>{st.oscRunning ? 'Listening' : 'Off'}</span>
              <PortBox label="OSC port" value={st.oscPort} onSave={(oscPort) => save({ oscPort })} />
              <label className="check">
                <input type="checkbox" checked={st.oscLocalOnly} onChange={(e) => save({ oscLocalOnly: e.target.checked })} /> Only from this computer
              </label>
            </section>
            {st.osc && !st.oscLocalOnly && (
              <p className="field__note field__note--warn">OSC has no token: anyone on this network can send it commands. Turn this on only on a network you trust.</p>
            )}
            {st.error && <p className="field__note field__note--warn">{st.error}</p>}

            <div className="field">
              <span className="field__label">Token</span>
              <div className="capi__token">
                <code data-testid="api-token">{showToken ? st.token : '•'.repeat(24)}</code>
                <button type="button" className="icon" aria-label={showToken ? 'Hide the token' : 'Show the token'} onClick={() => setShowToken((v) => !v)}>
                  {showToken ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
                <button type="button" className="btn btn--small" onClick={() => copy('token', st.token)}>
                  <Copy aria-hidden="true" /> {copied === 'token' ? 'Copied' : 'Copy'}
                </button>
                {confirmNew ? (
                  <>
                    <span className="field__note">Everything using the old token stops working.</span>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => {
                        setConfirmNew(false);
                        void newApiToken().then(setSt, () => {});
                      }}
                    >
                      Make a new token
                    </button>
                    <button type="button" className="linkbtn" onClick={() => setConfirmNew(false)}>
                      Keep this one
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn--small" onClick={() => setConfirmNew(true)}>
                    <RefreshCw aria-hidden="true" /> New token
                  </button>
                )}
              </div>
              <p className="field__note">
                Send it as <code>Authorization: Bearer …</code>, as <code>X-Lumora-Token</code>, or add <code>?token=…</code> to the address. The phone remote’s
                addresses take it in place of the PIN too.
              </p>
            </div>

            {st.running && st.addresses.length > 0 && (
              <div className="field">
                <span className="field__label">Addresses</span>
                <ul className="capi__addrs">
                  {st.addresses.map((a) => (
                    <li key={a}>
                      <code>{a}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="field">
              <span className="field__label">Bitfocus Companion</span>
              <p className="field__note">
                Add the <b>Lumora</b> connection (the module is in the <code>companion</code> folder that comes with Lumora), type this computer’s address, the
                port and the token. Its buttons light red and green with the tally, and show recording and live. Or use Companion’s “Generic HTTP” connection
                with the addresses below.
              </p>
            </div>

            <details className="capi__examples">
              <summary>Example addresses</summary>
              <table>
                <tbody>
                  {examples(base, showToken ? st.token : 'YOUR-TOKEN').map((x) => (
                    <tr key={x.what}>
                      <td>{x.what}</td>
                      <td>
                        <code>{x.url}</code>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--small"
                          aria-label={`Copy address for ${x.what}`}
                          onClick={() => copy(x.what, x.url.replace('YOUR-TOKEN', st.token))}
                        >
                          {copied === x.what ? 'Copied' : 'Copy'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="field__note">
                WebSocket: <code>{`${ws}/api/ws?token=…`}</code> — send <code>{'{"cmd":"take","screen":"live"}'}</code>; the tally and what is running come by
                themselves. OSC: <code>/lumora/cut</code>, <code>/lumora/preview 3</code>, <code>/lumora/overlay 1 1</code>, <code>/lumora/macro "Start show"</code>.
                Every command is in Help → How to use Lumora → Control API.
              </p>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
