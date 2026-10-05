import { useEffect, useState } from 'react';
import type { EngineClient } from '../engine/client';
import { JoinSetup, useAudienceLink } from './JoinSetup';
import type { Source } from '../engine/types/Source';
import { eligible, money, raised } from '../engine/audience';
import { FundraiserView, RaffleView, WallView } from '../components/AudienceViews';
import type { WallStyle } from '../engine/types/WallStyle';
import type { Act } from './act';
import './LyricsCard.css';
import './AudienceCards.css';

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
  const { remote } = useAudienceLink(client, r, (joinUrl, joinQr) => r && act({ type: 'updateRaffle', id, raffle: { ...r, joinUrl, joinQr } }));
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
                Draw a winner
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
            <JoinSetup remote={remote} what="enter" client={client} act={act} />
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
  const { remote } = useAudienceLink(client, f, (joinUrl, joinQr) => f && act({ type: 'updateFundraiser', id, fundraiser: { ...f, joinUrl, joinQr } }));
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
            <JoinSetup remote={remote} what="pledge" client={client} act={act} />
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

const STYLES: { style: WallStyle; label: string }[] = [
  { style: 'cards', label: 'One at a time' },
  { style: 'grid', label: 'Newest six' },
  { style: 'ticker', label: 'Ticker along the bottom' },
];

/** Run a messages wall: let messages and photos through, pick how they show. */
export function WallCard({ source, act, client, onClose }: { source: Source; act: Act; client: EngineClient; onClose: () => void }) {
  const w = source.kind.type === 'wall' ? source.kind : null;
  const id = source.id;
  const [setup, setSetup] = useState(() => (w ? { title: w.title, prompt: w.prompt } : null));
  const [typed, setTyped] = useState({ name: '', text: '' });
  const [filter, setFilter] = useState<'waiting' | 'shown' | 'all'>('all');
  const { remote } = useAudienceLink(client, w, (joinUrl, joinQr) => w && act({ type: 'updateWall', id, wall: { ...w, joinUrl, joinQr } }));
  useEsc(onClose);
  if (!w || !setup) return null;
  const update = (p: Partial<typeof w>) => act({ type: 'updateWall', id, wall: { ...w, ...p } });
  const waiting = w.messages.filter((m) => !m.approved).length;
  const add = () => {
    if (!typed.text.trim()) return;
    act({ type: 'wallAdd', id, name: typed.name, text: typed.text });
    setTyped({ name: typed.name, text: '' });
  };
  const list = [...w.messages].reverse().filter((m) => (filter === 'waiting' ? !m.approved : filter === 'shown' ? m.approved : true));
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Messages wall" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box lyc">
        <header className="modal__head">
          <h2>Messages wall · {source.name}</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="lyc__body">
          <section className="lyc__run">
            <div className="lyc__stage">
              <WallView w={w} url={(p) => client.mediaUrl(p)} />
            </div>
            <div className="lyc__bar">
              <button type="button" className={`btn${w.open ? ' is-on' : ' btn--primary'}`} onClick={() => act({ type: 'wallOpen', id, value: !w.open })}>
                {w.open ? '■ Stop taking messages' : '▶ Take messages from phones'}
              </button>
              {w.pinned !== null && (
                <button type="button" className="btn" onClick={() => act({ type: 'wallPin', id })}>
                  Let them take turns again
                </button>
              )}
            </div>
            <div className="lyc__bar" role="group" aria-label="How it looks">
              {STYLES.map((s) => (
                <button
                  key={s.style}
                  type="button"
                  className={`btn btn--small${w.style === s.style ? ' is-on' : ''}`}
                  onClick={() => update({ style: s.style })}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="lyc__row">
              <label className="check">
                <input type="checkbox" checked={w.autoApprove} onChange={(e) => update({ autoApprove: e.target.checked })} /> Show messages from phones straight
                away
              </label>
              <label className="check">
                <input type="checkbox" checked={w.photos} onChange={(e) => update({ photos: e.target.checked })} /> Phones may send a photo
              </label>
              <label className="check">
                <input type="checkbox" checked={w.showJoin} onChange={(e) => update({ showJoin: e.target.checked })} /> Show the code to scan
              </label>
            </div>
            <JoinSetup remote={remote} what="send messages" client={client} act={act} />
            <details className="aud-card__setup">
              <summary>Title, question and timing</summary>
              <label className="field">
                <span className="field__label">Title</span>
                <input
                  className="text"
                  dir="auto"
                  value={setup.title}
                  onChange={(e) => setSetup({ ...setup, title: e.target.value })}
                  onBlur={() => update(setup)}
                />
              </label>
              <label className="field">
                <span className="field__label">What people are asked on their phones</span>
                <input
                  className="text"
                  dir="auto"
                  value={setup.prompt}
                  onChange={(e) => setSetup({ ...setup, prompt: e.target.value })}
                  onBlur={() => update(setup)}
                />
              </label>
              <label className="field">
                <span className="field__label">Seconds on screen each (one at a time)</span>
                <input
                  className="text"
                  type="number"
                  min={3}
                  max={60}
                  value={w.seconds}
                  onChange={(e) => update({ seconds: Math.min(60, Math.max(3, Number(e.target.value) || 8)) })}
                />
              </label>
            </details>
          </section>
          <section className="lyc__edit">
            <div className="aud-card__gift aud-card__gift--wall">
              <input className="text" placeholder="From" value={typed.name} onChange={(e) => setTyped({ ...typed, name: e.target.value })} aria-label="From" />
              <input
                className="text"
                dir="auto"
                placeholder="Type a message or dedication"
                value={typed.text}
                maxLength={280}
                onChange={(e) => setTyped({ ...typed, text: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && add()}
                aria-label="Message"
              />
              <button type="button" className="btn btn--primary" onClick={add}>
                + Add
              </button>
            </div>
            <div className="lyc__bar" role="group" aria-label="Which messages">
              {(
                [
                  ['all', `All ${w.messages.length}`],
                  ['waiting', `Waiting ${waiting}`],
                  ['shown', `On screen ${w.messages.length - waiting}`],
                ] as const
              ).map(([f, label]) => (
                <button key={f} type="button" className={`btn btn--small${filter === f ? ' is-on' : ''}`} onClick={() => setFilter(f)}>
                  {label}
                </button>
              ))}
            </div>
            <ul className="aud-card__list aud-card__list--wall">
              {list.length === 0 && <li className="aud-card__none">No messages yet.</li>}
              {list.map((m) => (
                <li key={m.id} className={`${m.approved ? '' : 'is-waiting'}${w.pinned === m.id ? ' is-winner' : ''}`}>
                  {m.photo && <img src={client.mediaUrl(m.photo)} alt="" />}
                  <span dir="auto">
                    {m.name && <b>{m.name}: </b>}
                    {m.text || <em>(a photo)</em>}
                  </span>
                  {!m.approved ? (
                    <button type="button" className="btn btn--small btn--primary" onClick={() => act({ type: 'wallApprove', id, message: m.id, value: true })}>
                      Let through
                    </button>
                  ) : (
                    <button type="button" className="btn btn--small" onClick={() => act({ type: 'wallApprove', id, message: m.id, value: false })}>
                      Hold back
                    </button>
                  )}
                  <button
                    type="button"
                    className={`btn btn--small${w.pinned === m.id ? ' is-on' : ''}`}
                    title="Keep this one on screen"
                    onClick={() => act({ type: 'wallPin', id, message: w.pinned === m.id ? undefined : m.id })}
                  >
                    {w.pinned === m.id ? 'Showing' : 'Show now'}
                  </button>
                  <button type="button" className="icon" aria-label="Remove" onClick={() => act({ type: 'wallRemove', id, message: m.id })}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            {w.messages.length > 0 && (
              <button type="button" className="btn btn--small" onClick={() => confirm('Remove every message?') && act({ type: 'wallRemove', id })}>
                Remove every message
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
