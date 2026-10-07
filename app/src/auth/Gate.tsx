import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { authOn } from './config';
import { TEST_BUILD } from '../e2e';
import { mayUse, paused, PRODUCT_NAME, type Access, type Product } from './access';
import { checkAccess, MIN_PASSWORD, onSignInChange, signIn, signOut, signUp, signUpsOpen, supabase } from './auth';
import { featureLabel, turnedOff, type FeatureKey } from './rules';
import { AccessCtx } from './accessContext';
import { CodeForm, TwoStepSetup } from './TwoStep';
import { openSitePage } from '../site';
import '../views/ControlView.css';
import './Gate.css';

/** The loading window gives way (Lumora and Lumora Studio both answer this). */
function appReady(): void {
  if ('__TAURI_INTERNALS__' in window) void invoke('app_ready').catch(() => {});
}

export { useAccess, useFeature } from './accessContext';

type Gate = { s: 'checking' } | { s: 'out' } | { s: 'in'; access: Access } | { s: 'error'; message: string };

/**
 * Lumora (and Lumora Studio) opens only for people the Lumora team has
 * approved and set up for that app: sign in (or make an account), then wait
 * for approval. Once approved it keeps working offline
 * for a while, so events without internet are fine. Off while there is no
 * sign-in set up (auth/config.ts).
 */
export function Gate({ product, children }: { product: Product; children: ReactNode }) {
  const [gate, setGate] = useState<Gate>({ s: 'checking' });
  // Once let in, Lumora stays open until the person signs out or closes it:
  // a sign-in that lapses mid-event (no internet when the session renews, a
  // server hiccup) must never close the control window and end the stream.
  // If the server says the account changed (blocked, not approved, the app
  // turned off), a note says so; the next start is checked again.
  const letIn = useRef(false);
  const [changed, setChanged] = useState<string | boolean>(false);
  // Features the Lumora team switched off while the app is open (a note says so).
  const [offNote, setOffNote] = useState<FeatureKey[]>([]);
  const lastAccess = useRef<Access | null>(null);
  const check = useCallback(() => {
    const keep = (next: Gate) => {
      const ok = next.s === 'in' && mayUse(next.access, product);
      if (ok) {
        if (letIn.current && !next.access.offline) {
          const off = turnedOff(lastAccess.current?.rules, next.access.rules);
          if (off.length) setOffNote((was) => [...new Set([...was, ...off])]);
        }
        letIn.current = true;
        lastAccess.current = next.access;
        setChanged(false);
        setGate(next);
      } else if (!letIn.current) setGate(next);
      else if (next.s === 'in' && !next.access.offline && !next.access.codeNeeded)
        setChanged(paused(next.access, product) ? (next.access.rules?.pauseMessages[product] ?? '') || true : true);
    };
    checkAccess()
      .then((access) => keep(access ? { s: 'in', access } : { s: 'out' }))
      .catch((e: unknown) => keep({ s: 'error', message: e instanceof Error ? e.message : String(e) }));
  }, [product]);
  // The end-to-end test build (CI only, never an installer) has no sign-in: see e2e.ts.
  const locked = authOn() && !TEST_BUILD;
  useEffect(() => {
    if (!locked) return;
    check();
    return onSignInChange(check);
  }, [check, locked]);
  // Waiting for approval (or for this app to be turned on): look again every 20 seconds.
  const waiting = gate.s === 'in' && (gate.access.state === 'pending' || (gate.access.state === 'approved' && !mayUse(gate.access, product)));
  const open = gate.s === 'in' && mayUse(gate.access, product);
  useEffect(() => {
    if (!waiting || (gate.s === 'in' && (gate.access.codeNeeded || gate.access.setupNeeded))) return;
    const t = setInterval(check, 20_000);
    return () => clearInterval(t);
  }, [waiting, gate, check]);
  // While open: look again every 15 minutes (only ever to show the note).
  useEffect(() => {
    if (!open || !locked) return;
    const t = setInterval(check, 15 * 60_000);
    return () => clearInterval(t);
  }, [open, locked, check]);
  const leave = useCallback(
    () =>
      void signOut().then(() => {
        letIn.current = false;
        lastAccess.current = null;
        setChanged(false);
        setOffNote([]);
        setGate({ s: 'out' });
      }),
    [],
  );

  if (!locked) return <>{children}</>;
  if (gate.s === 'in' && mayUse(gate.access, product)) {
    return (
      <AccessCtx.Provider value={{ access: gate.access, signOut: leave }}>
        {changed !== false && <AccessChanged product={product} why={changed} onClose={() => setChanged(false)} />}
        {changed === false && offNote.length > 0 && <FeaturesChanged off={offNote} onClose={() => setOffNote([])} />}
        {children}
      </AccessCtx.Provider>
    );
  }
  return <GateScreen gate={gate} product={product} onCheck={check} onSignOut={leave} />;
}

/** The account changed while the app is open: it stays open (an event may be live), and says so. */
function AccessChanged({ product, why, onClose }: { product: Product; why: string | true; onClose: () => void }) {
  return (
    <div className="gate__banner" role="status">
      <span>
        {typeof why === 'string'
          ? `The Lumora team has paused ${PRODUCT_NAME[product]}${why ? `: ${why}` : '.'} It stays open now; it won't open the next time it starts.`
          : `Your access has changed; ${PRODUCT_NAME[product]} will close the next time it starts. Contact the Lumora team if you think this is a mistake.`}
      </span>
      <button type="button" className="icon" aria-label="Hide this note" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

/** Features switched off while the app is open: what is in use keeps working. */
function FeaturesChanged({ off, onClose }: { off: FeatureKey[]; onClose: () => void }) {
  return (
    <div className="gate__banner gate__banner--info" role="status">
      <span>
        The Lumora team turned off {off.map(featureLabel).join(', ')}. Anything in use keeps working; it's off once you stop using it or the next time the app
        starts.
      </span>
      <button type="button" className="icon" aria-label="Hide this note" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

function GateScreen({ gate, product, onCheck, onSignOut }: { gate: Gate; product: Product; onCheck: () => void; onSignOut: () => void }) {
  // The loading window gives way to this one.
  useEffect(() => {
    if (gate.s !== 'checking') appReady();
  }, [gate.s]);
  // Signed in, and nothing to do about the sign-in itself (code, two-step setup) first.
  const ready = gate.s === 'in' && !gate.access.codeNeeded && !gate.access.setupNeeded;
  const waitingText = gate.s === 'in' ? (gate.access.rules?.waitingMessage.trim() ?? '') : '';
  return (
    <div className="gate">
      <div className="gate__card">
        <div className="gate__brand">
          <img src={product === 'studio' ? './brand/studio-logo.svg' : './brand/lumora-logo.svg'} alt={PRODUCT_NAME[product]} />
        </div>
        {gate.s === 'checking' && <p className="gate__note">Checking your account…</p>}
        {gate.s === 'out' && <SignIn />}
        {gate.s === 'in' && !gate.access.codeNeeded && gate.access.setupNeeded && gate.access.state !== 'blocked' && (
          <div className="gate__form">
            <h1>Set up two-step sign-in</h1>
            <p className="gate__note">
              The Lumora team asks {gate.access.rules?.twoStep === 'team' ? 'its team accounts' : 'everyone'} to use two-step sign-in: a 6-digit code from an
              authenticator app on your phone, each time you sign in. It takes a minute.
            </p>
            <TwoStepSetup db={supabase()} onDone={onCheck} />
            <div className="gate__row">
              <button type="button" className="btn" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </div>
        )}
        {gate.s === 'in' && gate.access.codeNeeded && (
          <CodeForm db={supabase()} onDone={onCheck}>
            <div className="gate__row">
              <button type="button" className="btn" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </CodeForm>
        )}
        {gate.s === 'error' && (
          <>
            <h1>Can't check your account</h1>
            <p className="gate__note">{gate.message}</p>
            <div className="gate__row">
              <button type="button" className="btn btn--primary" onClick={onCheck}>
                Try again
              </button>
              <button type="button" className="btn" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </>
        )}
        {ready && gate.access.state === 'pending' && (
          <>
            <h1>Waiting for approval</h1>
            <p className="gate__note">
              Thanks{gate.access.name ? `, ${gate.access.name}` : ''}! Your account ({gate.access.email}) has been sent to the Lumora team. Lumora opens as soon
              as they approve it; you can leave this window open.
            </p>
            {waitingText && <p className="gate__note gate__custom">{waitingText}</p>}
            <div className="gate__row">
              <button type="button" className="btn btn--primary" onClick={onCheck}>
                Check again
              </button>
              <button type="button" className="btn" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </>
        )}
        {ready && gate.access.state === 'approved' && paused(gate.access, product) && (
          <>
            <h1>{PRODUCT_NAME[product]} is paused</h1>
            <p className="gate__note">
              {gate.access.rules?.pauseMessages[product] || `The Lumora team has paused ${PRODUCT_NAME[product]} for now. Please try again later.`}
            </p>
            <div className="gate__row">
              <button type="button" className="btn btn--primary" onClick={onCheck}>
                Check again
              </button>
              <button type="button" className="btn" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </>
        )}
        {ready && gate.access.state === 'approved' && !paused(gate.access, product) && !mayUse(gate.access, product) && (
          <>
            <h1>Your account isn't set up for {PRODUCT_NAME[product]}.</h1>
            <p className="gate__note">{waitingText || 'Contact the Lumora team for help.'}</p>
            <div className="gate__row">
              <button type="button" className="btn btn--primary" onClick={onCheck}>
                Check again
              </button>
              <button type="button" className="btn" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </>
        )}
        {gate.s === 'in' && !gate.access.codeNeeded && gate.access.state === 'blocked' && (
          <>
            <h1>This account can't use Lumora</h1>
            <p className="gate__note">The Lumora team has turned off access for {gate.access.email}. If you think this is a mistake, contact them.</p>
            <div className="gate__row">
              <button type="button" className="btn" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SignIn() {
  const [mode, setMode] = useState<'in' | 'new'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  // New sign-ups closed by the Lumora team: only invited emails make an account (the server decides).
  const [open, setOpen] = useState(true);
  useEffect(() => {
    let live = true;
    void signUpsOpen().then((o) => live && setOpen(o));
    return () => {
      live = false;
    };
  }, []);
  const go = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'in') await signIn(email, password);
      else if (!(await signUp(name, email, password)))
        setMessage({ text: 'Account made. Check your email and click the link to confirm it, then sign in here.', bad: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), bad: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="gate__form"
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
    >
      <h1>{mode === 'in' ? 'Sign in to Lumora' : 'Make your Lumora account'}</h1>
      <p className="gate__note">
        {mode === 'in'
          ? 'Use the email and password of your Lumora account.'
          : open
            ? 'The Lumora team approves each new account before it can be used.'
            : 'New sign-ups are closed: use the email address the Lumora team invited.'}
      </p>
      {mode === 'new' && (
        <label className="field">
          <span className="field__label">Your name</span>
          <input className="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </label>
      )}
      <label className="field">
        <span className="field__label">Email</span>
        <input className="text" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
      </label>
      <label className="field">
        <span className="field__label">Password</span>
        <input
          className="text"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          minLength={mode === 'in' ? undefined : MIN_PASSWORD}
          required
        />
      </label>
      {mode === 'new' && <p className="gate__note small">At least {MIN_PASSWORD} characters, with letters and numbers.</p>}
      {mode === 'new' && (
        <p className="gate__note small">
          By creating an account, you agree to the{' '}
          <button type="button" className="linkish" onClick={() => openSitePage('terms.html')}>
            Terms of Use
          </button>{' '}
          and{' '}
          <button type="button" className="linkish" onClick={() => openSitePage('privacy.html')}>
            Privacy Policy
          </button>
          .
        </p>
      )}
      {message && <p className={`gate__msg${message.bad ? ' is-bad' : ''}`}>{message.text}</p>}
      <button type="submit" className="btn btn--primary gate__go" disabled={busy}>
        {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Make my account'}
      </button>
      <p className="gate__switch">
        {mode === 'in' ? (open ? 'New to Lumora? ' : 'Invited by the Lumora team? ') : 'Already have an account? '}
        <button
          type="button"
          className="linkish"
          onClick={() => {
            setMode(mode === 'in' ? 'new' : 'in');
            setMessage(null);
          }}
        >
          {mode === 'in' ? (open ? 'Make an account' : 'Make your account') : 'Sign in'}
        </button>
      </p>
    </form>
  );
}
