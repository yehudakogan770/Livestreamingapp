import { useEffect, useState } from 'react';
import type { EngineClient, RemoteStatus } from '../engine/client';
import type { Source } from '../engine/types/Source';
import { eligible, money, raised } from '../engine/audience';
import { FundraiserView, RaffleView } from '../components/AudienceViews';
import type { Act } from './act';
import './LyricsCard.css';
import './AudienceCards.css';

/** The phone remote's audience page: kept on the input so its code can show on screen. */
function useAudienceLink(client: EngineClient, has: { joinUrl: string; joinQr: string } | null, save: (url: string, qr: string) => void) {
  const [remote, setRemote] = useState<RemoteStatus | null>(null);
  useEffect(() => client.watchRemote(setRemote), [client]);
  const address = remote?.running ? remote.addresses[0] : undefined;
  useEffect(() => {
    if (!has || !address || (has.joinUrl === address.voteUrl && has.joinQr === address.voteQr)) return;
    save(address.voteUrl, address.voteQr);
  }, [address?.voteUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  return { remote, address };
}

function RemoteNote({ remote, url, what, onTurnOn }: { remote: RemoteStatus | null; url?: string; what: string; onTurnOn: () => void }) {
  return !remote?.running ? (
    <p className="field__note field__note--warn">
      Phones {what} through the phone remote, which is off.{' '}
      <button type="button" className="btn btn--small" onClick={onTurnOn}>
        Turn it on
      </button>
    </p>
  ) : (
    <p className="field__note">
      Phones on this network {what} at <b>{url}</b> — no PIN needed.
    </p>
  );
}

function useEsc(onClose: () => void) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
}

/** Run a raffle: take names, draw winners on screen. */
export function RaffleCard({ source, act, client, onClose }: { source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const r = source.kind.type === 'raffle' ? source.kind : null;
  const id = source.id;
  const [title, setTitle] = useState(r?.title ?? '');
  const [prize, setPrize] = useState(r?.prize ?? '');
  const [names, setNames] = useState('');
  const { remote, address } = useAudienceLink(client, r, (joinUrl, joinQr) => r && act({ type: 'updateRaffle', id, raffle: { ...r, joinUrl, joinQr } }));
  useEsc(onClose);
  if (!r) return null;
  const update = (p: Partial<typeof r>) => act({ type: 'updateRaffle', id, raffle: { ...r, ...p } });
  const left = eligible(r).length;
  const nameOf = (e: number) => r.entries.find((x) => x.id === e)?.name ?? '';
  const addNames = () => {
    const list = names
      .split(/\n|,/)
      .map((n) => n.trim())
      .filter(Boolean);
    if (list.length) act({ type: 'raffleAdd', id, names: list });
    setNames('');
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Raffle" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box lyc">
        <header className="modal__head">
          <h2>Raffle · {source.name}</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="lyc__body">
          <section className="lyc__run">
            <div className="lyc__stage">
              <RaffleView r={r} />
            </div>
            <div className="lyc__bar">
              <button type="button" className="btn btn--primary btn--big" disabled={!left} onClick={() => act({ type: 'raffleDraw', id })}>
                🎲 Draw a winner
              </button>
              <button type="button" className={`btn${r.open ? ' is-on' : ''}`} onClick={() => act({ type: 'raffleOpen', id, value: !r.open })}>
                {r.open ? '■ Stop taking names' : '▶ Take names from phones'}
              </button>
            </div>
            <p className="field__note">
              {r.entries.length} entered · {left} can still win · put this input on air (or on an overlay) so everyone sees the draw.
            </p>
            {r.winners.length > 0 && (
              <div className="aud-card__winners">
                <b>Winners:</b> {r.winners.map((w, i) => `${i + 1}. ${nameOf(w)}`).join('   ')}
                <button type="button" className="btn btn--small" onClick={() => act({ type: 'raffleReset', id })}>
                  Forget the winners
                </button>
              </div>
            )}
            <RemoteNote remote={remote} url={address?.voteUrl} what="enter" onTurnOn={() => void client.setRemote(true)} />
          </section>
          <section className="lyc__edit">
            <label className="field">
              <span className="field__label">Title</span>
              <input className="text" dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => update({ title })} />
            </label>
            <label className="field">
              <span className="field__label">Prize</span>
              <input className="text" dir="auto" value={prize} onChange={(e) => setPrize(e.target.value)} onBlur={() => update({ prize })} />
            </label>
            <div className="lyc__row">
              <label className="check">
                <input type="checkbox" checked={r.repeatWinners} onChange={(e) => update({ repeatWinners: e.target.checked })} /> A winner can win again
              </label>
              <label className="check">
                <input type="checkbox" checked={r.showJoin} onChange={(e) => update({ showJoin: e.target.checked })} /> Show the code to scan
              </label>
            </div>
            <label className="field">
              <span className="field__label">Add names (one on each line, or pasted from a list)</span>
              <textarea className="text" dir="auto" rows={3} value={names} onChange={(e) => setNames(e.target.value)} aria-label="Names to add" />
            </label>
            <button type="button" className="btn" disabled={!names.trim()} onClick={addNames}>
              Add these names
            </button>
            <ul className="aud-card__list">
              {[...r.entries].reverse().map((e) => (
                <li key={e.id} className={r.winners.includes(e.id) ? 'is-winner' : ''}>
                  <span dir="auto">{e.name}</span>
                  <button type="button" className="icon" aria-label={`Take out ${e.name}`} onClick={() => act({ type: 'raffleRemove', id, entry: e.id })}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            {r.entries.length > 0 && (
              <button
                type="button"
                className="btn btn--small"
                onClick={() => confirm('Take everyone out and start again?') && act({ type: 'raffleRemove', id })}
              >
                Start again from nobody
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Run a fundraiser: the goal, pledges from phones, donations typed in. */
export function FundraiserCard({ source, act, client, onClose }: { source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const f = source.kind.type === 'fundraiser' ? source.kind : null;
  const id = source.id;
  const [setup, setSetup] = useState(() => (f ? { title: f.title, currency: f.currency, goal: String(f.goal), starting: String(f.starting) } : null));
  const [gift, setGift] = useState({ name: '', amount: '', message: '' });
  const { remote, address } = useAudienceLink(
    client,
    f,
    (joinUrl, joinQr) => f && act({ type: 'updateFundraiser', id, fundraiser: { ...f, joinUrl, joinQr } }),
  );
  useEsc(onClose);
  if (!f || !setup) return null;
  const update = (p: Partial<typeof f>) => act({ type: 'updateFundraiser', id, fundraiser: { ...f, ...p } });
  const saveSetup = () =>
    update({
      title: setup.title,
      currency: setup.currency,
      goal: Math.max(1, Math.floor(Number(setup.goal.replace(/[^0-9.]/g, '')) || f.goal)),
      starting: Math.max(0, Math.floor(Number(setup.starting.replace(/[^0-9.]/g, '')) || 0)),
    });
  const add = () => {
    const amount = Math.floor(Number(gift.amount.replace(/[^0-9.]/g, '')));
    if (!(amount > 0)) return;
    act({ type: 'addDonation', id, name: gift.name, amount, message: gift.message });
    setGift({ name: '', amount: '', message: '' });
  };
  const waiting = f.pledges.filter((p) => !p.approved).length;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Fundraiser" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box lyc">
        <header className="modal__head">
          <h2>Fundraiser · {source.name}</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="lyc__body">
          <section className="lyc__run">
            <div className="lyc__stage">
              <FundraiserView f={f} />
            </div>
            <div className="lyc__bar">
              <button type="button" className={`btn${f.open ? ' is-on' : ' btn--primary'}`} onClick={() => act({ type: 'fundraiserOpen', id, value: !f.open })}>
                {f.open ? '■ Stop taking pledges' : '▶ Take pledges from phones'}
              </button>
              <label className="check">
                <input type="checkbox" checked={f.autoApprove} onChange={(e) => update({ autoApprove: e.target.checked })} /> Count phone pledges straight away
              </label>
              <label className="check">
                <input type="checkbox" checked={f.showDonors} onChange={(e) => update({ showDonors: e.target.checked })} /> Show donors
              </label>
              <label className="check">
                <input type="checkbox" checked={f.showJoin} onChange={(e) => update({ showJoin: e.target.checked })} /> Show the code to scan
              </label>
            </div>
            <p className="field__note">
              {money(f, raised(f))} of {money(f, f.goal)} · {f.pledges.length} gifts{waiting ? ` · ${waiting} waiting for you to count them` : ''}. Lumora takes
              no payments: pledges are promises, collected the usual way.
            </p>
            <RemoteNote remote={remote} url={address?.voteUrl} what="pledge" onTurnOn={() => void client.setRemote(true)} />
            <div className="aud-card__gift">
              <input
                className="text"
                placeholder="Name"
                value={gift.name}
                onChange={(e) => setGift({ ...gift, name: e.target.value })}
                aria-label="Donor name"
              />
              <input
                className="text"
                placeholder="Amount"
                inputMode="numeric"
                value={gift.amount}
                onChange={(e) => setGift({ ...gift, amount: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && add()}
                aria-label="Amount"
              />
              <input
                className="text"
                placeholder="Message"
                value={gift.message}
                onChange={(e) => setGift({ ...gift, message: e.target.value })}
                aria-label="Message"
              />
              <button type="button" className="btn btn--primary" onClick={add}>
                + Add a donation
              </button>
            </div>
          </section>
          <section className="lyc__edit">
            <label className="field">
              <span className="field__label">Title</span>
              <input className="text" dir="auto" value={setup.title} onChange={(e) => setSetup({ ...setup, title: e.target.value })} onBlur={saveSetup} />
            </label>
            <div className="lyc__row">
              <label className="field" style={{ width: 70 }}>
                <span className="field__label">Currency</span>
                <input
                  className="text"
                  value={setup.currency}
                  maxLength={4}
                  onChange={(e) => setSetup({ ...setup, currency: e.target.value })}
                  onBlur={saveSetup}
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span className="field__label">Goal</span>
                <input
                  className="text"
                  inputMode="numeric"
                  value={setup.goal}
                  onChange={(e) => setSetup({ ...setup, goal: e.target.value })}
                  onBlur={saveSetup}
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span className="field__label">Raised before</span>
                <input
                  className="text"
                  inputMode="numeric"
                  value={setup.starting}
                  onChange={(e) => setSetup({ ...setup, starting: e.target.value })}
                  onBlur={saveSetup}
                />
              </label>
            </div>
            <span className="field__label">Gifts (newest first)</span>
            <ul className="aud-card__list">
              {[...f.pledges].reverse().map((p) => (
                <li key={p.id} className={p.approved ? '' : 'is-waiting'}>
                  <span dir="auto">
                    <b>{p.name || 'Anonymous'}</b> {money(f, p.amount)}
                    {p.message && ` · ${p.message}`}
                  </span>
                  {!p.approved ? (
                    <button type="button" className="btn btn--small btn--primary" onClick={() => act({ type: 'pledgeApprove', id, pledge: p.id, value: true })}>
                      Count it
                    </button>
                  ) : (
                    <button type="button" className="btn btn--small" onClick={() => act({ type: 'pledgeApprove', id, pledge: p.id, value: false })}>
                      Don't count
                    </button>
                  )}
                  <button type="button" className="icon" aria-label="Remove" onClick={() => act({ type: 'pledgeRemove', id, pledge: p.id })}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
