import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  audioPairs,
  cardDevices,
  cardSignals,
  cardUrl,
  connectionLabel,
  parseCardUrl,
  signalFor,
  signalLine,
  type CardDevice,
  type CardSignal,
  type Connection,
} from '../engine/decklink';
import './DeckLinkPicker.css';

/**
 * Add input → Blackmagic capture card: the cards in this computer, the
 * connector (SDI or HDMI) and which pair of embedded audio channels is heard.
 * Calls `onChange` with the input's address (null until a card is chosen).
 */
export function DeckLinkPicker({ onChange }: { onChange: (url: string | null) => void }) {
  const [cards, setCards] = useState<CardDevice[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [pair, setPair] = useState(0);
  const look = useCallback(() => {
    setBusy(true);
    setProblem(null);
    cardDevices()
      .then(
        (list) => {
          const capture = list.filter((d) => d.canCapture);
          setCards(capture);
          // One card: chosen already.
          if (capture.length === 1) setDevice((d) => d ?? capture[0]!.name);
        },
        (e: unknown) => {
          setCards([]);
          setProblem(e instanceof Error ? e.message : String(e));
        },
      )
      .finally(() => setBusy(false));
  }, []);
  useEffect(look, [look]);
  const card = cards?.find((c) => c.name === device) ?? null;
  useEffect(() => {
    onChange(card ? cardUrl({ device: card.name, connection: card.inputs.length > 1 ? (connection ?? card.inputs[0]!) : null, audioPair: pair }) : null);
  }, [card, connection, pair, onChange]);
  return (
    <div className="field cardpick">
      <span className="field__label">Choose a capture card</span>
      {busy && cards === null && <span className="field__note">Looking for Blackmagic cards…</span>}
      {problem && (
        <span className="field__note field__note--warn" role="alert">
          {problem}
        </span>
      )}
      {cards && cards.length === 0 && !problem && (
        <span className="field__note">
          No Blackmagic card was found. Check it shows in Blackmagic Desktop Video Setup (an UltraStudio needs its power and Thunderbolt cable).
        </span>
      )}
      {cards && cards.length > 0 && (
        <div className="addinput__list">
          {cards.map((c) => (
            <button key={c.name} type="button" className="seg" aria-pressed={device === c.name} onClick={() => setDevice(c.name)} title={c.model}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="linkbtn" onClick={look} disabled={busy}>
        <RefreshCw aria-hidden="true" className="cardpick__icon" /> Look again
      </button>
      {card && card.inputs.length > 1 && (
        <>
          <span className="field__label">Input</span>
          <div className="addinput__list" role="group" aria-label="Input connector">
            {card.inputs.map((c) => (
              <button key={c} type="button" className="seg" aria-pressed={(connection ?? card.inputs[0]) === c} onClick={() => setConnection(c)}>
                {connectionLabel(c)}
              </button>
            ))}
          </div>
        </>
      )}
      {card && (
        <label className="field">
          <span className="field__label">Sound</span>
          <select value={pair} onChange={(e) => setPair(Number(e.target.value))} aria-label="Audio channels">
            {audioPairs(card.audioChannels).map((p) => (
              <option key={p.pair} value={p.pair}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="field__note">
            {card.detectsFormat
              ? 'The card finds the picture’s format by itself (resolution, frame rate, interlaced). SDI carries up to 16 audio channels: choose the pair to hear.'
              : 'This card can’t find the format by itself: set the camera to 1080i59.94.'}
          </span>
        </label>
      )}
    </div>
  );
}

/** How a card input is doing, for its settings: "1080i59.94 · 8-bit YUV · TC 10:00:03:12". */
export function CardSignalLine({ url }: { url: string }) {
  const [signal, setSignal] = useState<CardSignal | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      void cardSignals().then(
        (all) => live && setSignal(signalFor(all, url)),
        () => {},
      );
    read();
    const id = setInterval(read, 1000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [url]);
  const a = parseCardUrl(url);
  if (!a) return null;
  return (
    <p className={`field__note${signal && signal.state !== 'live' ? ' field__note--warn' : ''}`} role="status">
      {a.device}
      {a.connection ? ` (${connectionLabel(a.connection)})` : ''} · {signal ? signalLine(signal) : 'Not open yet'}
    </p>
  );
}
