import { CircleUserRound, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { Access } from './access';
import { changeName, changePassword, MIN_PASSWORD, supabase, twoStepStatus } from './auth';
import { turnOffTwoStep, type TwoStepState } from './mfa';
import { TwoStepSetup as TwoStepSetupForm } from './TwoStep';

type Note = { text: string; bad: boolean } | null;

/** Your own account: your name, your password, and two-step sign-in. */
export function AccountDialog({ access, onClose }: { access: Access; onClose: () => void }) {
  const [name, setName] = useState(access.name);
  const [nameNote, setNameNote] = useState<Note>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [pwNote, setPwNote] = useState<Note>(null);
  const [busy, setBusy] = useState<'name' | 'pw' | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const saveName = (e: FormEvent) => {
    e.preventDefault();
    setBusy('name');
    setNameNote(null);
    changeName(name)
      .then(() => setNameNote({ text: 'Name saved.', bad: false }))
      .catch((err: unknown) => setNameNote({ text: err instanceof Error ? err.message : String(err), bad: true }))
      .finally(() => setBusy(null));
  };
  const savePassword = (e: FormEvent) => {
    e.preventDefault();
    if (next !== again) {
      setPwNote({ text: 'The two new passwords are not the same.', bad: true });
      return;
    }
    setBusy('pw');
    setPwNote(null);
    changePassword(access.email, current, next)
      .then(() => {
        setPwNote({ text: 'Password changed. Use the new one next time you sign in.', bad: false });
        setCurrent('');
        setNext('');
        setAgain('');
      })
      .catch((err: unknown) => setPwNote({ text: err instanceof Error ? err.message : String(err), bad: true }))
      .finally(() => setBusy(null));
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="My account" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box account">
        <header className="modal__head">
          <h2>
            <CircleUserRound className="modal__icon" aria-hidden="true" />
            My account
          </h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="account__body">
          <p className="account__who">
            {access.email}
            {access.admin ? ' · Lumora team' : ''}
          </p>
          <form className="account__part" onSubmit={saveName}>
            <h3>Your name</h3>
            <label className="field">
              <span className="field__label">Name</span>
              <input className="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" required />
            </label>
            {nameNote && <p className={`gate__msg${nameNote.bad ? ' is-bad' : ''}`}>{nameNote.text}</p>}
            <button type="submit" className="btn btn--primary" disabled={busy !== null || name.trim() === access.name}>
              {busy === 'name' ? 'Saving…' : 'Save name'}
            </button>
          </form>
          <form className="account__part" onSubmit={savePassword}>
            <h3>Change password</h3>
            <label className="field">
              <span className="field__label">Current password</span>
              <input className="text" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
            </label>
            <label className="field">
              <span className="field__label">New password</span>
              <input
                className="text"
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD}
                required
              />
            </label>
            <label className="field">
              <span className="field__label">New password again</span>
              <input
                className="text"
                type="password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD}
                required
              />
            </label>
            {pwNote && <p className={`gate__msg${pwNote.bad ? ' is-bad' : ''}`}>{pwNote.text}</p>}
            <button type="submit" className="btn btn--primary" disabled={busy !== null}>
              {busy === 'pw' ? 'Changing…' : 'Change password'}
            </button>
          </form>
          <TwoStepPart admin={access.admin} />
        </div>
      </div>
    </div>
  );
}

/** Two-step sign-in: on or off, and turning it on (scan a code) or off (with the current code). */
export function TwoStepPart({ admin }: { admin: boolean }) {
  const [st, setSt] = useState<TwoStepState | null>(null);
  const [mode, setMode] = useState<'view' | 'on' | 'off'>('view');
  const [code, setCode] = useState('');
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    twoStepStatus()
      .then(setSt)
      .catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : String(e), bad: true }));
  useEffect(() => {
    void load();
  }, []);
  const off = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    turnOffTwoStep(supabase(), code)
      .then(() => {
        setMode('view');
        setCode('');
        setNote({ text: 'Two-step sign-in is off.', bad: false });
        return load();
      })
      .catch((err: unknown) => setNote({ text: err instanceof Error ? err.message : String(err), bad: true }))
      .finally(() => setBusy(false));
  };
  return (
    <div className="account__part">
      <h3>Two-step sign-in</h3>
      {st === null && !note && <p className="field__note">Checking…</p>}
      {st && !st.on && mode === 'view' && (
        <>
          <p className="field__note">
            Off. With it on, signing in also needs a 6-digit code from an app on your phone, so a stolen password alone can’t open your account.
            {admin ? ' The Lumora team needs it to approve people and see problem reports.' : ''}
          </p>
          <button type="button" className="btn btn--primary" onClick={() => setMode('on')}>
            Turn on two-step sign-in
          </button>
        </>
      )}
      {mode === 'on' && (
        <TwoStepSetupForm
          db={supabase()}
          onDone={() => {
            setMode('view');
            setNote({ text: 'Two-step sign-in is on. Lumora will ask for a code each time you sign in.', bad: false });
            void load();
          }}
          onCancel={() => setMode('view')}
        />
      )}
      {st?.on && mode === 'view' && (
        <>
          <p className="field__note">On: signing in asks for the code from your authenticator app.</p>
          <button type="button" className="btn" onClick={() => setMode('off')}>
            Turn off…
          </button>
        </>
      )}
      {mode === 'off' && (
        <form className="twostep" onSubmit={off}>
          <p className="field__note">
            Type the current code from your authenticator app to turn two-step sign-in off.
            {admin ? ' Without it, People and approvals stops working for you.' : ''}
          </p>
          <label className="field">
            <span className="field__label">6-digit code</span>
            <input
              className="text twostep__code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </label>
          <div className="gate__row">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? 'Turning off…' : 'Turn off'}
            </button>
            <button type="button" className="btn" onClick={() => setMode('view')}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {note && <p className={`gate__msg${note.bad ? ' is-bad' : ''}`}>{note.text}</p>}
    </div>
  );
}
