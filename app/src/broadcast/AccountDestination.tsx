import { open } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useId, useState } from 'react';
import type { Destination, EngineClient } from '../engine/client';
import {
  accounts,
  expiresSoon,
  fromLocalInput,
  HEALTH_WORDS,
  linkProblem,
  PHASE_WORDS,
  PROVIDER_NAMES,
  thumbnailFrom,
  toLocalInput,
  type AccountLink,
  type AccountsInfo,
  type Broadcast,
  type FacebookLink,
  type SessionView,
  type Target,
  type YoutubeLink,
} from './accounts';
import { snapshot } from './snapshot';

const words = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The connected accounts (loaded once; connecting updates them). */
export function useAccountsInfo(): [AccountsInfo | null, (i: AccountsInfo) => void] {
  const [info, setInfo] = useState<AccountsInfo | null>(null);
  useEffect(() => {
    let alive = true;
    void accounts.info().then(
      (i) => alive && setInfo(i),
      () => {},
    );
    return () => void (alive = false);
  }, []);
  return [info, setInfo];
}

/** The watch link, with a button that copies it. */
function WatchLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  if (!url) return null;
  return (
    <span className="bcd__row acct__watch">
      <span className="field__note">Watch link:</span>
      <input className="text bcd__grow" value={url} readOnly aria-label="Watch link" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn"
        onClick={() =>
          void navigator.clipboard?.writeText(url).then(
            () => setCopied(true),
            () => {},
          )
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

/** Where the broadcast is and how YouTube or Facebook receives the stream. */
export function SessionBadge({ session }: { session: SessionView | undefined }) {
  if (!session) return null;
  return (
    <div className="acct__status" role="status">
      <span className={`acct__health acct__health--${session.health}`}>
        {PHASE_WORDS[session.phase]} · Signal: {HEALTH_WORDS[session.health]}
      </span>
      {session.message && <span className="field__note field__note--warn">{session.message}</span>}
      {session.issues.map((i) => (
        <span key={i} className="field__note">
          {i}
        </span>
      ))}
      <WatchLink url={session.watchUrl} />
    </div>
  );
}

interface Props {
  dest: Destination;
  info: AccountsInfo;
  setInfo: (i: AccountsInfo) => void;
  session: SessionView | undefined;
  client: EngineClient;
  onChange: (patch: Partial<Destination>) => void;
  onRemove: () => void;
}

/** A destination that goes through a connected YouTube or Facebook account (no stream key to copy). */
export function AccountDestination({ dest, info, setInfo, session, client, onChange, onRemove }: Props) {
  const link = dest.account!;
  const provider = link.provider;
  const name = PROVIDER_NAMES[provider];
  const p = info[provider];
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (what: string, f: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(words(e));
    } finally {
      setBusy(null);
    }
  }, []);
  const setLink = (patch: Partial<YoutubeLink> | Partial<FacebookLink>) => onChange({ account: { ...link, ...patch } as AccountLink });
  const problem = linkProblem(link, info);

  // Facebook's manual sign-in (when the browser can't come back to Lumora).
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');

  return (
    <div className="bcd__destbody acct">
      <div className="bcd__row">
        <input className="text" value={dest.name} maxLength={40} onChange={(e) => onChange({ name: e.target.value })} aria-label="Name" />
        <span className="acct__kind">{name} — connected account</span>
        <span className="bcd__grow" />
        <button type="button" className="btn" onClick={onRemove} aria-label={`Remove ${dest.name}`}>
          Remove
        </button>
      </div>

      {!p.setUp ? (
        <p className="field__note field__note--warn">
          Connecting a {name} account isn’t set up in this copy of Lumora yet (the person who set up Lumora adds it once — see Help → Going live with YouTube
          and Facebook accounts). Until then, add {name} with a stream key: + Add a destination.
        </p>
      ) : !p.connected ? (
        <div className="acct__connect">
          <span className="bcd__row">
            <button
              type="button"
              className="btn btn--primary"
              disabled={!!busy}
              onClick={() => void run('connect', async () => setInfo(await accounts.connect(provider)))}
            >
              Connect {name} account
            </button>
            {busy === 'connect' && (
              <>
                <span className="field__note">Finish signing in in the browser…</span>
                <button type="button" className="btn" onClick={() => void accounts.cancel()}>
                  Cancel
                </button>
              </>
            )}
            {provider === 'facebook' && !busy && (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void run('manual', async () => {
                    await accounts.facebookManual();
                    setPasting(true);
                  })
                }
              >
                Connect by pasting the address
              </button>
            )}
          </span>
          {pasting && (
            <span className="bcd__row">
              <input
                className="text bcd__grow"
                value={pasted}
                placeholder="https://www.facebook.com/connect/login_success.html#access_token=…"
                aria-label="Address Facebook ended on"
                autoComplete="off"
                onChange={(e) => setPasted(e.target.value)}
              />
              <button
                type="button"
                className="btn"
                disabled={!pasted.trim() || !!busy}
                onClick={() =>
                  void run('paste', async () => {
                    setInfo(await accounts.facebookPaste(pasted));
                    setPasting(false);
                    setPasted('');
                  })
                }
              >
                Finish
              </button>
            </span>
          )}
          <span className="field__note">
            Your browser opens {name}’s own sign-in page; Lumora never sees your password.
            {provider === 'facebook' &&
              ' If the browser ends on a page that says “Success”, use Connect by pasting the address and paste that page’s address here.'}
          </span>
        </div>
      ) : (
        <span className="bcd__row">
          <span className="acct__who">
            Connected: <strong>{p.name || name}</strong>
          </span>
          <span className="bcd__grow" />
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            onClick={() => void run('disconnect', async () => setInfo(await accounts.disconnect(provider)))}
          >
            Disconnect
          </button>
        </span>
      )}
      {p.connected && provider === 'facebook' && expiresSoon(p) && (
        <p className="field__note field__note--warn">
          Facebook keeps this connection for only an hour or two, and it runs out soon. Disconnect and connect again just before going live.
        </p>
      )}

      {p.connected && link.provider === 'youtube' && <YoutubeFields link={link} setLink={setLink} run={run} busy={busy} client={client} />}
      {p.connected && link.provider === 'facebook' && <FacebookFields link={link} setLink={setLink} run={run} />}

      {error && (
        <p className="field__note field__note--warn" role="alert">
          {error}
        </p>
      )}
      {problem && p.setUp && p.connected && <p className="field__note field__note--warn">{problem}</p>}
      <SessionBadge session={session} />
    </div>
  );
}

type Run = (what: string, f: () => Promise<void>) => Promise<void>;

function YoutubeFields({
  link,
  setLink,
  run,
  busy,
  client,
}: {
  link: YoutubeLink;
  setLink: (patch: Partial<YoutubeLink>) => void;
  run: Run;
  busy: string | null;
  client: EngineClient;
}) {
  const [list, setList] = useState<Broadcast[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => void run('list', async () => setList(await accounts.broadcasts())), [run]);
  useEffect(load, [load]);
  const chosen = list?.find((b) => b.id === link.broadcastId) ?? null;
  const kids = useId();
  const s = link.settings;
  const set = (patch: Partial<YoutubeLink['settings']>) => setLink({ settings: { ...s, ...patch } });

  // A thumbnail: uploaded now to a chosen broadcast, or kept for the one made at go-live.
  const applyThumbnail = async (path: string) => {
    if (link.broadcastId) {
      await accounts.thumbnail(link.broadcastId, path);
      setNote('Thumbnail uploaded to YouTube.');
    } else {
      setLink({ thumbnail: path });
      setNote('The thumbnail is uploaded when Lumora goes live.');
    }
  };
  const pickPicture = () =>
    void run('thumb', async () => {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'Pictures (JPG or PNG, under 2 MB)', extensions: ['jpg', 'jpeg', 'png'] }],
      });
      if (typeof path === 'string') await applyThumbnail(path);
    });
  const liveScreen = () =>
    void run('thumb', async () => {
      const { show } = await client.getShow();
      const picture = await thumbnailFrom(await snapshot(client, show, 'live', 1280, 720));
      await applyThumbnail(await accounts.saveThumbnail(picture));
    });
  const createNow = () =>
    void run('create', async () => {
      const b = await accounts.createBroadcast(s);
      setList((l) => [b, ...(l ?? [])]);
      setLink({ broadcastId: b.id });
      if (link.thumbnail) await accounts.thumbnail(b.id, link.thumbnail).catch(() => {});
      setNote('Broadcast made on YouTube. Share the watch link now; Lumora uses this broadcast when it goes live.');
    });

  return (
    <div className="acct__fields">
      <label className="field">
        <span className="field__label">Broadcast</span>
        <span className="bcd__row">
          <select className="bcd__grow" value={link.broadcastId} onChange={(e) => setLink({ broadcastId: e.target.value })} aria-label="YouTube broadcast">
            <option value="">A new broadcast each time Lumora goes live</option>
            {list?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title || 'Untitled'}
                {b.scheduledStart ? ` — ${new Date(b.scheduledStart).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
              </option>
            ))}
            {link.broadcastId && list && !chosen && <option value={link.broadcastId}>The broadcast chosen before (not found now)</option>}
          </select>
          <button type="button" className="btn" disabled={!!busy} onClick={load}>
            {busy === 'list' ? 'Loading…' : 'Refresh'}
          </button>
        </span>
        <span className="field__note">Broadcasts planned in YouTube Studio are listed too. Lumora sends to its own reusable stream and links it for you.</span>
      </label>

      {chosen ? (
        <>
          <p className="field__note">
            {chosen.privacy === 'public' ? 'Public' : chosen.privacy === 'unlisted' ? 'Unlisted' : 'Private'} ·{' '}
            {chosen.autoStart ? 'YouTube starts it by itself' : 'Lumora starts it when the stream arrives'} ·{' '}
            {chosen.autoStop ? 'YouTube ends it by itself' : 'Lumora ends it when you stop'}. Change these in YouTube Studio.
          </p>
          <WatchLink url={chosen.watchUrl} />
        </>
      ) : (
        <>
          <label className="field">
            <span className="field__label">Title</span>
            <input className="text" value={s.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} aria-label="Broadcast title" />
          </label>
          <label className="field">
            <span className="field__label">Description</span>
            <textarea
              className="text"
              rows={3}
              value={s.description}
              maxLength={5000}
              onChange={(e) => set({ description: e.target.value })}
              aria-label="Broadcast description"
            />
          </label>
          <div className="bcd__row">
            <label className="field bcd__grow">
              <span className="field__label">Who can watch</span>
              <select value={s.privacy} onChange={(e) => set({ privacy: e.target.value as YoutubeLink['settings']['privacy'] })} aria-label="Privacy">
                <option value="public">Public — anyone</option>
                <option value="unlisted">Unlisted — anyone with the link</option>
                <option value="private">Private — only you</option>
              </select>
            </label>
            <label className="field bcd__grow">
              <span className="field__label">Scheduled start (optional)</span>
              <input
                className="text"
                type="datetime-local"
                value={toLocalInput(s.scheduledStart)}
                onChange={(e) => set({ scheduledStart: fromLocalInput(e.target.value) })}
                aria-label="Scheduled start"
              />
            </label>
          </div>
          <fieldset className="field acct__kids">
            <legend className="field__label">Is it made for kids? (YouTube requires an answer)</legend>
            <label className="check">
              <input type="radio" name={kids} checked={s.kidsChosen && !s.madeForKids} onChange={() => set({ kidsChosen: true, madeForKids: false })} /> No,
              it’s not made for kids
            </label>
            <label className="check">
              <input type="radio" name={kids} checked={s.kidsChosen && s.madeForKids} onChange={() => set({ kidsChosen: true, madeForKids: true })} /> Yes, it’s
              made for kids (comments and some features are off)
            </label>
          </fieldset>
          <div className="bcd__row">
            <label className="field bcd__grow">
              <span className="field__label">Delay for viewers</span>
              <select value={s.latency} onChange={(e) => set({ latency: e.target.value as YoutubeLink['settings']['latency'] })} aria-label="Latency">
                <option value="normal">Normal — best picture</option>
                <option value="low">Low — less delay</option>
                <option value="ultraLow">Ultra-low — least delay (no 4K, no rewinding)</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={s.dvr} onChange={(e) => set({ dvr: e.target.checked })} /> Viewers can rewind while it’s live (DVR)
          </label>
          <label className="check">
            <input type="checkbox" checked={s.autoStart} onChange={(e) => set({ autoStart: e.target.checked })} /> YouTube goes live by itself when the stream
            arrives (off: Lumora takes it live when you press GO LIVE)
          </label>
          <label className="check">
            <input type="checkbox" checked={s.autoStop} onChange={(e) => set({ autoStop: e.target.checked })} /> YouTube ends the broadcast by itself when the
            stream stops (off: Lumora ends it when you stop the stream — a dropped connection never ends it)
          </label>
          <span className="bcd__row">
            <button type="button" className="btn" disabled={!!busy || !s.kidsChosen} onClick={createNow}>
              {busy === 'create' ? 'Making it…' : 'Make the broadcast now (to share the link ahead)'}
            </button>
          </span>
        </>
      )}

      <label className="field">
        <span className="field__label">Thumbnail (optional)</span>
        <span className="bcd__row">
          <button type="button" className="btn" disabled={!!busy} onClick={pickPicture}>
            Choose a picture…
          </button>
          <button type="button" className="btn" disabled={!!busy} onClick={liveScreen}>
            Use the Live Screen now
          </button>
          {!chosen && link.thumbnail && (
            <>
              <span className="field__note acct__file">{link.thumbnail.split(/[\\/]/).pop()}</span>
              <button type="button" className="btn" onClick={() => setLink({ thumbnail: '' })}>
                No thumbnail
              </button>
            </>
          )}
        </span>
        <span className="field__note">
          A JPG or PNG under 2 MB, 1280 × 720 is best. Custom thumbnails need a verified YouTube account (youtube.com/verify).
        </span>
      </label>
      {note && <p className="field__note">{note}</p>}
      <p className="field__note">YouTube’s backup server is filled in by itself: if the main one fails, Lumora reconnects to the backup.</p>
    </div>
  );
}

function FacebookFields({ link, setLink, run }: { link: FacebookLink; setLink: (patch: Partial<FacebookLink>) => void; run: Run }) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const load = useCallback(() => void run('targets', async () => setTargets(await accounts.targets())), [run]);
  useEffect(load, [load]);
  const s = link.settings;
  const set = (patch: Partial<FacebookLink['settings']>) => setLink({ settings: { ...s, ...patch } });
  return (
    <div className="acct__fields">
      <label className="field">
        <span className="field__label">Go live on</span>
        <span className="bcd__row">
          <select
            className="bcd__grow"
            value={link.targetId}
            aria-label="Facebook Page"
            onChange={(e) => {
              const t = targets?.find((x) => x.id === e.target.value);
              setLink({ targetId: e.target.value, targetName: t?.name ?? '' });
            }}
          >
            <option value="">Choose a Page…</option>
            {targets?.map((t) => (
              <option key={t.id} value={t.id} disabled={!t.canPublish}>
                {t.name}
                {t.canPublish ? '' : ' (you can’t post there)'}
              </option>
            ))}
            {link.targetId && targets && !targets.some((t) => t.id === link.targetId) && (
              <option value={link.targetId}>{link.targetName || 'The Page chosen before'}</option>
            )}
          </select>
          <button type="button" className="btn" onClick={load}>
            Refresh
          </button>
        </span>
        <span className="field__note">The Pages you manage. Facebook makes a new live video each time Lumora goes live and ends it when you stop.</span>
      </label>
      <label className="field">
        <span className="field__label">Title</span>
        <input className="text" value={s.title} maxLength={255} onChange={(e) => set({ title: e.target.value })} aria-label="Live video title" />
      </label>
      <label className="field">
        <span className="field__label">Description</span>
        <textarea className="text" rows={3} value={s.description} onChange={(e) => set({ description: e.target.value })} aria-label="Live video description" />
      </label>
      {link.targetId === 'me' && (
        <label className="field">
          <span className="field__label">Who can watch</span>
          <select value={s.privacy} onChange={(e) => set({ privacy: e.target.value as FacebookLink['settings']['privacy'] })} aria-label="Facebook privacy">
            <option value="everyone">Everyone</option>
            <option value="friends">Friends</option>
            <option value="onlyMe">Only me</option>
          </select>
        </label>
      )}
    </div>
  );
}
