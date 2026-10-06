import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { confirmCode, enterCode, startTwoStep, type NewAuthenticator } from './mfa';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function CodeInput({ value, onChange, autoFocus = true }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="field">
      <span className="field__label">6-digit code</span>
      <input
        className="text input twostep__code"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 -]*"
        maxLength={9}
        placeholder="123 456"
        aria-label="6-digit code"
        autoFocus={autoFocus}
        required
      />
    </label>
  );
}

/** At sign-in: the code from the authenticator app. */
export function CodeForm({ db, onDone, children }: { db: SupabaseClient; onDone: () => void; children?: ReactNode }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    enterCode(db, code)
      .then(onDone)
      .catch((err: unknown) => {
        setError(message(err));
        setCode('');
      })
      .finally(() => setBusy(false));
  };
  return (
    <form className="gate__form twostep" onSubmit={go}>
      <h1>Two-step sign-in</h1>
      <p className="gate__note">Open the authenticator app on your phone and type the 6-digit code for Lumora.</p>
      <CodeInput value={code} onChange={setCode} />
      {error && <p className="gate__msg is-bad warn">{error}</p>}
      <button type="submit" className="btn btn--primary gate__go" disabled={busy}>
        {busy ? 'Checking…' : 'Continue'}
      </button>
      {children}
      <p className="gate__note small muted">Lost your phone? Ask the Lumora team to turn off two-step sign-in for your account.</p>
    </form>
  );
}

/** Turning two-step sign-in on: scan the QR code (or type the key), then type a code to confirm. */
export function TwoStepSetup({ db, issuer, onDone, onCancel }: { db: SupabaseClient; issuer?: string; onDone: () => void; onCancel?: () => void }) {
  const [auth, setAuth] = useState<NewAuthenticator | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    startTwoStep(db, issuer)
      .then((a) => live && setAuth(a))
      .catch((e: unknown) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [db, issuer]);
  const go = (e: FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    setBusy(true);
    setError('');
    confirmCode(db, auth.factorId, code)
      .then(onDone)
      .catch((err: unknown) => setError(message(err)))
      .finally(() => setBusy(false));
  };
  return (
    <form className="twostep" onSubmit={go}>
      <ol className="twostep__steps">
        <li>Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
        <li>In the app, add an account and scan this code.</li>
      </ol>
      {auth ? (
        <>
          <img className="twostep__qr" src={auth.qr} alt="QR code for your authenticator app" width={180} height={180} />
          <p className="field__note small muted">
            Can’t scan it? Type this key instead: <code className="twostep__key">{auth.secret}</code>
          </p>
        </>
      ) : (
        !error && <p className="field__note muted">Making your code…</p>
      )}
      <ol className="twostep__steps" start={3}>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      <CodeInput value={code} onChange={setCode} autoFocus={false} />
      {error && <p className="gate__msg is-bad warn">{error}</p>}
      <div className="gate__row row">
        <button type="submit" className="btn btn--primary" disabled={busy || !auth}>
          {busy ? 'Checking…' : 'Turn on two-step sign-in'}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
