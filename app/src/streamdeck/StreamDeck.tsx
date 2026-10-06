import { LayoutGrid, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { RemoteStatus } from '../engine/client';
import { NO_DECK, deckOffer, deckStatus, deckSummary, dismissDeck, installDeck, type DeckStatus } from './streamDeck';
import './StreamDeck.css';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The Stream Deck as Lumora sees it; looked at again whenever asked. */
export function useDeck(): [DeckStatus, () => void, (s: DeckStatus) => void] {
  const [status, setStatus] = useState<DeckStatus>(NO_DECK);
  const refresh = useCallback(() => void deckStatus().then(setStatus, () => {}), []);
  useEffect(refresh, [refresh]);
  return [status, refresh, setStatus];
}

/** Once, when a Stream Deck is found without Lumora's buttons (or with older ones). */
export function StreamDeckOffer({ status, onChange }: { status: DeckStatus; onChange: (s: DeckStatus) => void }) {
  // Not in the first moments after Lumora opens.
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 6000);
    return () => clearTimeout(t);
  }, []);
  const offer = deckOffer(status);
  if (!ready || (!offer && !problem)) return null;
  const add = () => {
    setBusy(true);
    installDeck()
      .then(onChange, (e: unknown) => setProblem(message(e)))
      .finally(() => setBusy(false));
  };
  const later = () => {
    setProblem(null);
    void dismissDeck().then(onChange, () => onChange({ ...status, offer: false }));
  };
  return (
    <div className="sd-offer" role="status">
      <LayoutGrid className="sd-offer__icon" aria-hidden="true" />
      <span>{problem ?? offer?.text}</span>
      {!problem && (
        <button type="button" className="btn btn--primary" disabled={busy} onClick={add}>
          {offer?.add}
        </button>
      )}
      <button type="button" className="btn" onClick={later}>
        {problem ? 'Close' : 'Not now'}
      </button>
    </div>
  );
}

/** Settings → Stream Deck: what is there, and adding Lumora's buttons. */
export function StreamDeckDialog({
  status,
  remote,
  onChange,
  onRemote,
  onClose,
}: {
  status: DeckStatus;
  remote: RemoteStatus | null;
  onChange: (s: DeckStatus) => void;
  onRemote: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const summary = deckSummary(status);
  const add = () => {
    setBusy(true);
    setProblem(null);
    installDeck()
      .then(
        (s) => {
          onChange(s);
          setAsked(true);
        },
        (e: unknown) => setProblem(message(e)),
      )
      .finally(() => setBusy(false));
  };
  const address = remote?.addresses[0]?.url.replace(/^http:\/\//, '');
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Stream Deck" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box sd">
        <header className="modal__head">
          <h2>
            <LayoutGrid className="modal__icon" aria-hidden="true" />
            Stream Deck
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="sd__body">
          <p className="sd__intro">
            Lumora’s buttons for the Elgato Stream Deck: TAKE, CUT, inputs with red and green tally, overlays, presets, instant replay, recording and going
            live.
          </p>
          <p className="sd__status" data-testid="streamdeck-status">
            {summary.text}
          </p>
          {asked && (
            <p className="field__note">The Stream Deck app asks to add the buttons: choose Install. They appear under “Lumora” in its list of actions.</p>
          )}
          <ol className="sd__steps">
            <li>
              Turn on the phone remote: the buttons connect through it.{' '}
              {remote?.running ? (
                <>
                  Its PIN is <span className="sd__pin">{remote.pin}</span>.
                </>
              ) : (
                <button type="button" className="btn sd__inline" onClick={onRemote}>
                  Phone remote…
                </button>
              )}
            </li>
            <li>In the Stream Deck app, drag a Lumora button onto a key.</li>
            <li>
              In the button’s settings, type the PIN.
              {address ? (
                <>
                  {' '}
                  Stream Deck on another computer: type this computer’s address too, <span className="sd__pin">{address}</span>.
                </>
              ) : null}
            </li>
          </ol>
          {problem && (
            <p className="field__note field__note--warn" role="alert">
              {problem}
            </p>
          )}
        </div>
        <footer className="modal__foot">
          <span className="sd__spacer" />
          {summary.action && (
            <button type="button" className={`btn${status.found && (!status.installed || status.update) ? ' btn--primary' : ''}`} disabled={busy} onClick={add}>
              {summary.action}
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
