import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Source } from '../engine/types/Source';
import type { AuctionItem } from '../engine/types/AuctionItem';
import { amount, current, minimum, newItem, raisedAt, top } from '../engine/auction';
import { AuctionView } from '../components/AudienceViews';
import { JoinSetup, useAudienceLink } from './JoinSetup';
import type { Act } from './act';
import './LyricsCard.css';
import './AudienceCards.css';

const num = (s: string) => Math.floor(Number(s.replace(/[^0-9.]/g, '')));

/** Run a live auction: items one by one, bids from phones and the room, "Sold!". */
export function AuctionCard({ source, act, client, onClose }: { source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const a = source.kind.type === 'auction' ? source.kind : null;
  const id = source.id;
  const [form, setForm] = useState<{ item: AuctionItem; start: string; step: string }>({ item: newItem(), start: '100', step: '10' });
  const [room, setRoom] = useState({ name: '', amount: '' });
  const [setup, setSetup] = useState(() => (a ? { title: a.title, currency: a.currency } : null));
  const { remote } = useAudienceLink(client, a, (joinUrl, joinQr) => a && act({ type: 'updateAuction', id, auction: { ...a, joinUrl, joinQr } }));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!a || !setup) return null;
  const it = current(a);
  const best = it ? top(it) : null;
  const saveItem = () => {
    const f = form.item;
    if (!f.name.trim()) return;
    act({ type: 'auctionSetItem', id, item: { ...f, start: num(form.start) || 1, step: num(form.step) || 1 } });
    setForm({ item: newItem(), start: form.start, step: form.step });
  };
  const edit = (x: AuctionItem) => setForm({ item: x, start: String(x.start), step: String(x.step) });
  const roomBid = () => {
    const n = num(room.amount);
    if (!(n > 0)) return;
    act({ type: 'auctionRoomBid', id, name: room.name, amount: n });
    setRoom({ name: '', amount: '' });
  };
  const pickPhoto = async () => {
    const [f] = await client.pickFiles('image');
    if (f) setForm({ ...form, item: { ...form.item, photo: f.path } });
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Auction" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box lyc">
        <header className="modal__head">
          <h2>Auction · {source.name}</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="lyc__body">
          <section className="lyc__run">
            <div className="lyc__stage">
              <AuctionView a={a} url={(p) => client.mediaUrl(p)} />
            </div>
            <div className="lyc__bar">
              <button type="button" className="btn" disabled={a.current <= 0} onClick={() => act({ type: 'auctionGo', id, index: a.current - 1 })}>
                ◀ Previous
              </button>
              {it?.sold ? (
                <button type="button" className="btn" onClick={() => act({ type: 'auctionSold', id, value: false })}>
                  Undo “Sold”
                </button>
              ) : (
                <button type="button" className="btn btn--primary btn--big" disabled={!best} onClick={() => act({ type: 'auctionSold', id, value: true })}>
                  🔨 Sold!
                </button>
              )}
              <button
                type="button"
                className="btn"
                disabled={a.current >= a.items.length - 1}
                onClick={() => act({ type: 'auctionGo', id, index: a.current + 1 })}
              >
                Next item ▶
              </button>
              <button type="button" className={`btn${a.open ? ' is-on' : ''}`} onClick={() => act({ type: 'auctionOpen', id, value: !a.open })}>
                {a.open ? '■ Stop bids from phones' : '▶ Take bids from phones'}
              </button>
            </div>
            <div className="lyc__bar" role="group" aria-label="Countdown">
              <span className="field__label">Countdown</span>
              {[30, 60, 120, 300].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  className="btn btn--small"
                  disabled={!it || it.sold}
                  onClick={() => act({ type: 'auctionTimer', id, seconds: sec })}
                >
                  {sec < 60 ? `${sec}s` : `${sec / 60} min`}
                </button>
              ))}
              {a.endsAt !== null && (
                <button type="button" className="btn btn--small" onClick={() => act({ type: 'auctionTimer', id })}>
                  No countdown
                </button>
              )}
              <span className="field__note">A bid in the last 15 seconds adds time.</span>
            </div>
            {it && !it.sold && (
              <div className="aud-card__gift aud-card__gift--wall">
                <input
                  className="text"
                  placeholder="Bidder"
                  value={room.name}
                  onChange={(e) => setRoom({ ...room, name: e.target.value })}
                  aria-label="Bidder"
                />
                <input
                  className="text"
                  inputMode="numeric"
                  placeholder={`${amount(a, minimum(it))} or more`}
                  value={room.amount}
                  onChange={(e) => setRoom({ ...room, amount: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && roomBid()}
                  aria-label="Bid amount"
                />
                <button type="button" className="btn btn--primary" onClick={roomBid}>
                  + Bid from the room
                </button>
              </div>
            )}
            <p className="field__note">
              {a.items.filter((x) => x.sold).length} of {a.items.length} sold · raised {amount(a, raisedAt(a))}. Lumora takes no payments: winners pay the usual
              way.
            </p>
            <JoinSetup remote={remote} what="bid" client={client} act={act} />
            {it && it.bids.length > 0 && (
              <>
                <span className="field__label">Bids on {it.name} (highest first)</span>
                <ul className="aud-card__list">
                  {[...it.bids]
                    .sort((x, y) => y.amount - x.amount || x.at - y.at)
                    .map((b) => (
                      <li key={b.id} className={b.id === best?.id ? 'is-winner' : ''}>
                        <span dir="auto">
                          <b>{amount(a, b.amount)}</b> {b.name || 'Anonymous'}
                        </span>
                        <button
                          type="button"
                          className="icon"
                          aria-label={`Take out the bid of ${amount(a, b.amount)}`}
                          onClick={() => act({ type: 'auctionRemoveBid', id, item: it.id, bid: b.id })}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </section>
          <section className="lyc__edit">
            <span className="field__label">Items</span>
            <ol className="aud-card__list auc-card__items">
              {a.items.length === 0 && <li className="aud-card__none">No items yet — add the first below.</li>}
              {a.items.map((x, i) => {
                const b = top(x);
                return (
                  <li key={x.id} className={i === a.current ? 'is-winner' : ''}>
                    <span dir="auto">
                      <b>
                        {i + 1}. {x.name}
                      </b>{' '}
                      {x.sold ? `· sold ${amount(a, b?.amount ?? 0)}` : b ? `· ${amount(a, b.amount)}` : ''}
                    </span>
                    {i !== a.current && (
                      <button type="button" className="btn btn--small" onClick={() => act({ type: 'auctionGo', id, index: i })}>
                        Sell now
                      </button>
                    )}
                    <button type="button" className="btn btn--small" onClick={() => edit(x)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="icon"
                      aria-label={`Remove ${x.name}`}
                      onClick={() => (!x.bids.length || confirm(`Remove ${x.name} and its bids?`)) && act({ type: 'auctionRemoveItem', id, item: x.id })}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ol>
            <fieldset className="auc-card__form">
              <legend>{form.item.id ? 'Change the item' : 'Add an item'}</legend>
              <input
                className="text"
                dir="auto"
                placeholder="What is sold (a signed print, a weekend away…)"
                value={form.item.name}
                onChange={(e) => setForm({ ...form, item: { ...form.item, name: e.target.value } })}
                aria-label="Item"
              />
              <input
                className="text"
                dir="auto"
                placeholder="A line about it (optional: donated by…)"
                value={form.item.detail}
                onChange={(e) => setForm({ ...form, item: { ...form.item, detail: e.target.value } })}
                aria-label="About the item"
              />
              <div className="lyc__row">
                <label className="field" style={{ flex: 1 }}>
                  <span className="field__label">Starting bid</span>
                  <input
                    className="text"
                    inputMode="numeric"
                    value={form.start}
                    onChange={(e) => setForm({ ...form, start: e.target.value })}
                    aria-label="Starting bid"
                  />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  <span className="field__label">Each bid adds at least</span>
                  <input
                    className="text"
                    inputMode="numeric"
                    value={form.step}
                    onChange={(e) => setForm({ ...form, step: e.target.value })}
                    aria-label="Bid step"
                  />
                </label>
              </div>
              <div className="lyc__row">
                <button type="button" className="btn btn--small" onClick={() => void pickPhoto()}>
                  {form.item.photo ? '✓ Picture — change' : '🖼 Add a picture'}
                </button>
                {form.item.photo && (
                  <button type="button" className="btn btn--small" onClick={() => setForm({ ...form, item: { ...form.item, photo: '' } })}>
                    No picture
                  </button>
                )}
                <button type="button" className="btn btn--primary" disabled={!form.item.name.trim()} onClick={saveItem}>
                  {form.item.id ? 'Save the item' : '+ Add the item'}
                </button>
                {form.item.id !== 0 && (
                  <button type="button" className="btn btn--small" onClick={() => setForm({ item: newItem(), start: form.start, step: form.step })}>
                    Cancel
                  </button>
                )}
              </div>
            </fieldset>
            <details className="aud-card__setup">
              <summary>Title and currency</summary>
              <div className="lyc__row">
                <input
                  className="text"
                  dir="auto"
                  style={{ flex: 1 }}
                  value={setup.title}
                  onChange={(e) => setSetup({ ...setup, title: e.target.value })}
                  onBlur={() => act({ type: 'updateAuction', id, auction: { ...a, ...setup } })}
                  aria-label="Auction title"
                />
                <input
                  className="text"
                  style={{ width: 60 }}
                  maxLength={4}
                  value={setup.currency}
                  onChange={(e) => setSetup({ ...setup, currency: e.target.value })}
                  onBlur={() => act({ type: 'updateAuction', id, auction: { ...a, ...setup } })}
                  aria-label="Currency"
                />
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={a.showJoin}
                  onChange={(e) => act({ type: 'updateAuction', id, auction: { ...a, showJoin: e.target.checked } })}
                />{' '}
                Show the code to scan
              </label>
            </details>
          </section>
        </div>
      </div>
    </div>
  );
}
