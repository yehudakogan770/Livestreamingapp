import { CircleUserRound, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { Access } from './access';
import { changeName, changePassword } from './auth';

type Note = { text: string; bad: boolean } | null;

/** Your own account: your name, and your password. */
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
                minLength={6}
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
                minLength={6}
                required
              />
            </label>
            {pwNote && <p className={`gate__msg${pwNote.bad ? ' is-bad' : ''}`}>{pwNote.text}</p>}
            <button type="submit" className="btn btn--primary" disabled={busy !== null}>
              {busy === 'pw' ? 'Changing…' : 'Change password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
