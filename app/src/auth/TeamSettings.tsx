// For the Lumora team, in People and approvals: Sign-in settings, Features,
// invitations and one person's features. Shared by Lumora and Lumora Studio.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { APP_FEATURES, effectiveFeature, FEATURES, type FeatureInfo, type FeatureKey } from './rules';
import {
  cancelInvite,
  describeChange,
  inviteByEmail,
  offlineChoices,
  parseDomains,
  saveSettings,
  setOverride,
  SETTING_NAMES,
  validDomain,
  valueWords,
  when,
  type AdminSettings,
  type LogEntry,
  type SettingsChange,
  type SettingsRow,
} from './settings';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One choice of several, with what it means underneath. */
function Choice({ name, checked, onPick, label, help }: { name: string; checked: boolean; onPick: () => void; label: string; help: string }) {
  return (
    <label className={`settings__choice${checked ? ' is-on' : ''}`}>
      <input type="radio" name={name} checked={checked} onChange={onPick} />
      <span>
        <b>{label}</b>
        <small>{help}</small>
      </span>
    </label>
  );
}

function Section({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <fieldset className="settings__part">
      <legend>{title}</legend>
      {help && <p className="field__note">{help}</p>}
      {children}
    </fieldset>
  );
}

/** A change waiting to be saved, in words. */
interface Pending {
  key: string;
  words: string;
}

/** Save with a confirmation, then “Saved”. */
function SaveBar({ pending, onSave, onUndo }: { pending: Pending[]; onSave: () => Promise<void>; onUndo: () => void }) {
  const [state, setState] = useState<'idle' | 'confirm' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  useEffect(() => {
    if (pending.length && state === 'saved') setState('idle');
  }, [pending.length, state]);
  const save = () => {
    setState('saving');
    setError('');
    onSave()
      .then(() => setState('saved'))
      .catch((e: unknown) => {
        setError(message(e));
        setState('confirm');
      });
  };
  return (
    <div className="settings__save">
      {state === 'confirm' || state === 'saving' ? (
        <div className="settings__confirm" role="alertdialog" aria-label="Save these changes?">
          <b>Save these changes?</b>
          <ul>
            {pending.map((p) => (
              <li key={p.key}>{p.words}</li>
            ))}
          </ul>
          {error && <p className="gate__msg is-bad">{error}</p>}
          <div className="gate__row">
            <button type="button" className="btn btn--primary" disabled={state === 'saving'} onClick={save}>
              {state === 'saving' ? 'Saving…' : 'Yes, save'}
            </button>
            <button type="button" className="btn" disabled={state === 'saving'} onClick={() => setState('idle')}>
              Keep editing
            </button>
          </div>
        </div>
      ) : (
        <div className="gate__row">
          <button type="button" className="btn btn--primary" disabled={!pending.length} onClick={() => setState('confirm')}>
            Save changes
          </button>
          {pending.length > 0 && (
            <button type="button" className="btn" onClick={onUndo}>
              Undo changes
            </button>
          )}
          {state === 'saved' && !pending.length && (
            <span className="settings__saved" role="status">
              Saved
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function History({ log, only, title = 'History of changes' }: { log: LogEntry[]; only: (e: LogEntry) => boolean; title?: string }) {
  const shown = log.filter(only);
  return (
    <details className="settings__history">
      <summary>
        {title} ({shown.length})
      </summary>
      {shown.length === 0 ? (
        <p className="field__note">No changes yet.</p>
      ) : (
        <ul>
          {shown.map((e) => (
            <li key={e.id}>
              <span>{describeChange(e)}</span>
              <time dateTime={e.at}>{when(e.at)}</time>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** Who changed the settings last, and when. */
function LastChanged({ s }: { s: SettingsRow }) {
  if (!s.updated_at) return <p className="field__note">These are the usual settings; nobody has changed them yet.</p>;
  return (
    <p className="field__note">
      Last changed by {s.updated_by_name || 'the Lumora team'} on {when(s.updated_at)}.
    </p>
  );
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The settings being edited, and what changed compared with what is saved. */
function useDraft(saved: SettingsRow) {
  const [draft, setDraft] = useState<SettingsRow>(saved);
  const [base, setBase] = useState(saved);
  if (base !== saved) {
    // Saved (here or elsewhere): start again from what is saved now.
    setBase(saved);
    setDraft(saved);
  }
  const set = (c: SettingsChange) => setDraft((d) => ({ ...d, ...c }));
  return { draft, set, undo: () => setDraft(saved) };
}

const SIGN_IN_KEYS = [
  'approval',
  'auto_lumora',
  'auto_studio',
  'auto_domains',
  'signups',
  'two_step',
  'offline_days',
  'planner_makers',
  'waiting_message',
] as const;

/** Sign-in settings: how new accounts, sign-ups, two-step sign-in, offline use, the Planner and the waiting screen work. */
export function SignInSettingsTab({ data, onSaved }: { data: AdminSettings; onSaved: (d: AdminSettings) => void }) {
  const saved = data.settings;
  const { draft, set, undo } = useDraft(saved);
  const [domainsText, setDomainsText] = useState(saved.auto_domains.join(', '));
  const [base, setBase] = useState(saved);
  if (base !== saved) {
    setBase(saved);
    setDomainsText(saved.auto_domains.join(', '));
  }
  const domains = parseDomains(domainsText);
  const badDomain = domains.find((d) => !validDomain(d));
  const current: SettingsRow = { ...draft, auto_domains: badDomain ? saved.auto_domains : domains };
  const change: SettingsChange = {};
  const pending: Pending[] = [];
  for (const k of SIGN_IN_KEYS) {
    if (same(current[k], saved[k])) continue;
    (change as Record<string, unknown>)[k] = current[k];
    pending.push({ key: k, words: `${SETTING_NAMES[k]}: ${valueWords(k, current[k])}` });
  }
  const noApps = current.approval === 'auto' && !current.auto_lumora && !current.auto_studio;
  const save = async () => {
    if (badDomain) throw new Error(`“${badDomain}” is not a domain (like mycompany.com).`);
    if (noApps) throw new Error('Choose at least one app for accounts that are approved automatically.');
    onSaved(await saveSettings(change));
  };
  return (
    <div className="settings">
      <p className="field__note">These rules apply to Lumora, Lumora Studio and Lumora Planner. The Lumora account server enforces them, not only the apps.</p>
      <Section title="New accounts">
        <Choice
          name="approval"
          checked={current.approval === 'manual'}
          onPick={() => set({ approval: 'manual' })}
          label="Need my approval"
          help="New accounts wait in People until you approve them and choose their apps."
        />
        <Choice
          name="approval"
          checked={current.approval === 'auto'}
          onPick={() => set({ approval: 'auto' })}
          label="Approve automatically"
          help="New accounts can start right away, as soon as they confirm their email address."
        />
        {current.approval === 'auto' && (
          <div className="settings__more">
            <div className="people__apps" role="group" aria-label="Apps new accounts get">
              <span className="field__label">Apps they get:</span>
              <label className="check">
                <input type="checkbox" checked={current.auto_lumora} onChange={(e) => set({ auto_lumora: e.target.checked })} />
                Lumora
              </label>
              <label className="check">
                <input type="checkbox" checked={current.auto_studio} onChange={(e) => set({ auto_studio: e.target.checked })} />
                Studio
              </label>
            </div>
            {noApps && <p className="field__note field__note--warn">Choose at least one app.</p>}
            <label className="field">
              <span className="field__label">Only for emails from these domains (optional)</span>
              <input className="text" value={domainsText} onChange={(e) => setDomainsText(e.target.value)} placeholder="mycompany.com, partner.org" />
            </label>
            <p className="field__note">
              Leave this empty to approve every new account. With domains listed, only those emails are approved automatically; everyone else waits for your
              approval.
            </p>
            {badDomain && <p className="field__note field__note--warn">“{badDomain}” is not a domain (like mycompany.com).</p>}
          </div>
        )}
      </Section>
      <Section title="New sign-ups">
        <Choice
          name="signups"
          checked={current.signups === 'open'}
          onPick={() => set({ signups: 'open' })}
          label="Open"
          help="Anyone can create an account (and then waits for approval, unless approved automatically)."
        />
        <Choice
          name="signups"
          checked={current.signups === 'closed'}
          onPick={() => set({ signups: 'closed' })}
          label="Closed"
          help="Only people you invite (in the Invited tab, or to a Planner plan) can create an account. Existing accounts are not affected."
        />
      </Section>
      <Section title="Two-step sign-in">
        <Choice
          name="two_step"
          checked={current.two_step === 'optional'}
          onPick={() => set({ two_step: 'optional' })}
          label="Optional for everyone"
          help="Each person decides in My account whether to use a code from an authenticator app."
        />
        <Choice
          name="two_step"
          checked={current.two_step === 'team'}
          onPick={() => set({ two_step: 'team' })}
          label="Required for the Lumora team"
          help="Lumora team accounts must set it up the next time they sign in, and need the code every time."
        />
        <Choice
          name="two_step"
          checked={current.two_step === 'everyone'}
          onPick={() => set({ two_step: 'everyone' })}
          label="Required for everyone"
          help="Every account is asked to set it up at its next sign-in, and nothing opens until it does. Shows that are already running keep going."
        />
        {current.two_step !== 'optional' && saved.two_step === 'optional' && (
          <p className="field__note">Turn on two-step sign-in for your own account first (My account → Two-step sign-in), so you can’t be locked out.</p>
        )}
      </Section>
      <Section title="Offline use" help="How long the apps keep working without checking in with the Lumora account server (for events without internet).">
        <div className="settings__segs" role="radiogroup" aria-label="Days the apps keep working offline">
          {offlineChoices.map((d) => (
            <button key={d} type="button" className="seg" role="radio" aria-checked={current.offline_days === d} onClick={() => set({ offline_days: d })}>
              {d} {d === 1 ? 'day' : 'days'}
            </button>
          ))}
        </div>
        <p className="field__note">7 days is the usual. A shorter time means a blocked account stops working sooner; a longer one suits long tours.</p>
      </Section>
      <Section title="Planner">
        <Choice
          name="planner_makers"
          checked={current.planner_makers === 'lumora'}
          onPick={() => set({ planner_makers: 'lumora' })}
          label="Approved Lumora accounts make new plans"
          help="Everyone else can still work on the plans they are invited to."
        />
        <Choice
          name="planner_makers"
          checked={current.planner_makers === 'anyone'}
          onPick={() => set({ planner_makers: 'anyone' })}
          label="Any account makes new plans"
          help="Anyone who signs in to the Planner can make their own plans, even without approval for Lumora."
        />
      </Section>
      <Section
        title="Waiting message"
        help="Shown to people who are waiting for approval or whose account isn’t set up for an app. Leave it empty to show the usual words: “Contact the Lumora team for help.”"
      >
        <textarea
          className="text settings__message"
          value={current.waiting_message}
          maxLength={500}
          rows={3}
          aria-label="Waiting message"
          placeholder="For example: Email support@mycompany.com and we’ll set you up within a day."
          onChange={(e) => set({ waiting_message: e.target.value })}
        />
      </Section>
      <LastChanged s={saved} />
      <SaveBar
        pending={pending}
        onSave={save}
        onUndo={() => {
          undo();
          setDomainsText(saved.auto_domains.join(', '));
        }}
      />
      <History
        log={data.log}
        only={(e) => !e.setting.startsWith('features.') && !e.setting.startsWith('pause_messages.') && !e.setting.startsWith('person.')}
      />
    </div>
  );
}

function Switch({ f, on, onChange, children }: { f: FeatureInfo; on: boolean; onChange: (on: boolean) => void; children?: ReactNode }) {
  return (
    <div className="settings__feature">
      <label className="settings__switch">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} aria-label={f.label} />
        <span>
          <b>{f.label}</b>
          <small>{f.help}</small>
        </span>
        <em className={on ? 'is-on' : ''}>{on ? 'On' : f.key === 'lumora' || f.key === 'studio' || f.key === 'planner' ? 'Paused' : 'Off'}</em>
      </label>
      {children}
    </div>
  );
}

/** Features: the apps and features on or off for everyone. */
export function FeaturesTab({ data, onSaved }: { data: AdminSettings; onSaved: (d: AdminSettings) => void }) {
  const saved = data.settings;
  const { draft, set, undo } = useDraft(saved);
  const pending: Pending[] = [];
  const change: SettingsChange = {};
  const featureChange: Record<string, boolean> = {};
  const messageChange: Record<string, string> = {};
  for (const f of [...APP_FEATURES, ...FEATURES]) {
    const now = draft.features[f.key] !== false;
    if (now !== (saved.features[f.key] !== false)) {
      featureChange[f.key] = now;
      pending.push({ key: f.key, words: `${f.label}: ${now ? 'on' : f.key === 'lumora' || f.key === 'studio' || f.key === 'planner' ? 'paused' : 'off'}` });
    }
  }
  for (const f of APP_FEATURES) {
    const now = draft.pause_messages[f.key] ?? '';
    if (now.trim() !== (saved.pause_messages[f.key] ?? '')) {
      messageChange[f.key] = now.trim();
      pending.push({ key: `m-${f.key}`, words: `Message while ${f.label} is paused: ${now.trim() ? `“${now.trim()}”` : 'none'}` });
    }
  }
  if (Object.keys(featureChange).length) change.features = featureChange;
  if (Object.keys(messageChange).length) change.pause_messages = messageChange;
  const toggle = (k: FeatureKey, on: boolean) => set({ features: { ...draft.features, [k]: on } });
  return (
    <div className="settings">
      <p className="field__note">
        Turning something off never stops a show that is running: it applies the next time the app starts, or once the feature is no longer in use. The apps
        check every 15 minutes. You and the rest of the Lumora team can always open a paused app. To change a feature for just one person, open their row in
        People and choose Features.
      </p>
      <Section title="Apps" help="Pause an app for everyone, with a message saying why.">
        {APP_FEATURES.map((f) => {
          const on = draft.features[f.key] !== false;
          return (
            <Switch key={f.key} f={f} on={on} onChange={(v) => toggle(f.key, v)}>
              {!on && (
                <label className="field settings__more">
                  <span className="field__label">Message while paused</span>
                  <input
                    className="text"
                    value={draft.pause_messages[f.key] ?? ''}
                    maxLength={300}
                    placeholder={`${f.label} is paused for maintenance until 6 PM.`}
                    onChange={(e) => set({ pause_messages: { ...draft.pause_messages, [f.key]: e.target.value } })}
                  />
                </label>
              )}
            </Switch>
          );
        })}
      </Section>
      <Section title="Features" help="Sign-ups are in Sign-in settings → New sign-ups.">
        {FEATURES.map((f) => (
          <Switch key={f.key} f={f} on={draft.features[f.key] !== false} onChange={(v) => toggle(f.key, v)} />
        ))}
      </Section>
      <LastChanged s={saved} />
      <SaveBar pending={pending} onSave={async () => onSaved(await saveSettings(change))} onUndo={undo} />
      <History log={data.log} only={(e) => /^(features|pause_messages|person)\./.test(e.setting)} />
    </div>
  );
}

/** Invited: invite an email with chosen apps, and the invitations not used yet. */
export function InvitesTab({ data, onChanged }: { data: AdminSettings; onChanged: () => void }) {
  const [email, setEmail] = useState('');
  const [lumora, setLumora] = useState(true);
  const [studio, setStudio] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const go = (e: FormEvent) => {
    e.preventDefault();
    if (!lumora && !studio) {
      setNote({ text: 'Choose Lumora and/or Studio.', bad: true });
      return;
    }
    setBusy(true);
    setNote(null);
    const to = email.trim();
    inviteByEmail(to, lumora, studio)
      .then(({ pending }) => {
        setNote({
          text: pending
            ? `Invited. Lumora doesn’t send an email: tell ${to} to download Lumora and make an account with this address. They’re approved as soon as they confirm their email.`
            : `${to} already has an account: it’s approved with these apps now.`,
          bad: false,
        });
        setEmail('');
        onChanged();
      })
      .catch((err: unknown) => setNote({ text: message(err), bad: true }))
      .finally(() => setBusy(false));
  };
  const cancel = (e: string) =>
    void cancelInvite(e)
      .then(onChanged)
      .catch((err: unknown) => setNote({ text: message(err), bad: true }));
  return (
    <div className="settings">
      <form className="settings__part settings__invite" onSubmit={go}>
        <h3>Invite by email</h3>
        <p className="field__note">
          Approve someone before they sign up. When they make their account with this email and confirm it, they’re approved with the apps you choose (even
          while new sign-ups are closed).
        </p>
        <label className="field">
          <span className="field__label">Email</span>
          <input className="text" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@example.com" />
        </label>
        <div className="people__apps" role="group" aria-label="Apps for this invitation">
          <label className="check">
            <input type="checkbox" checked={lumora} onChange={(e) => setLumora(e.target.checked)} />
            Lumora
          </label>
          <label className="check">
            <input type="checkbox" checked={studio} onChange={(e) => setStudio(e.target.checked)} />
            Studio
          </label>
        </div>
        {note && <p className={`gate__msg${note.bad ? ' is-bad' : ''}`}>{note.text}</p>}
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Inviting…' : 'Invite'}
        </button>
      </form>
      <h3 className="settings__h">Invited, no account yet ({data.invites.length})</h3>
      {data.invites.length === 0 && <p className="people__empty">No invitations waiting.</p>}
      {data.invites.map((i) => (
        <div key={i.email} className="people__row">
          <div className="people__who">
            <b>{i.email}</b>
            <span>
              Invited{i.invited_by_name ? ` by ${i.invited_by_name}` : ''} on {when(i.created_at)}
            </span>
          </div>
          <span className="people__apps people__apps--text">{i.lumora && i.studio ? 'Lumora and Studio' : i.lumora ? 'Lumora only' : 'Studio only'}</span>
          <span className="people__tag people__tag--pending">Invited</span>
          <div className="people__acts">
            <button type="button" className="btn" onClick={() => cancel(i.email)}>
              Cancel invitation
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** One person's features: as for everyone, or on or off just for them. Saved at once. */
export function PersonFeatures({
  userId,
  name,
  admin,
  data,
  onChanged,
}: {
  userId: string;
  name: string;
  admin: boolean;
  data: AdminSettings;
  onChanged: () => Promise<void> | void;
}) {
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const own = (k: string) => data.overrides.find((o) => o.user_id === userId && o.feature === k)?.enabled;
  const pick = (k: FeatureKey, v: string) => {
    setNote(null);
    setOverride(userId, k, v === 'on' ? true : v === 'off' ? false : null)
      .then(() => onChanged())
      .then(() => setNote({ text: 'Saved', bad: false }))
      .catch((e: unknown) => setNote({ text: message(e), bad: true }));
  };
  return (
    <div className="people__features" role="group" aria-label={`Features for ${name}`}>
      <p className="field__note">Choose a feature just for {name}. “As for everyone” follows the Features tab.</p>
      {[...APP_FEATURES, ...FEATURES].map((f) => {
        const o = own(f.key);
        const everyone = data.settings.features[f.key] !== false;
        return (
          <label key={f.key} className="people__feature">
            <span>{f.label}</span>
            <select
              className="text"
              aria-label={`${f.label} for ${name}`}
              value={o === true ? 'on' : o === false ? 'off' : 'default'}
              onChange={(e) => pick(f.key, e.target.value)}
            >
              <option value="default">As for everyone ({everyone ? 'on' : 'off'})</option>
              <option value="on">On for them</option>
              <option value="off">Off for them</option>
            </select>
            <small>{effectiveFeature(f.key, data.settings.features, o, admin) ? 'On' : 'Off'}</small>
          </label>
        );
      })}
      {note && (
        <p className={`gate__msg${note.bad ? ' is-bad' : ''}`} role="status">
          {note.text}
        </p>
      )}
    </div>
  );
}
