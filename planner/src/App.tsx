import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { authOn } from '../../app/src/auth/config';
import { PlanList } from './PlanList';
import { PlanView } from './PlanView';
import { onSignInChange, signIn, signOut, whoAmI, type Who } from './session';

type Theme = 'auto' | 'light' | 'dark';
const THEME_KEY = 'lumora.planner.theme';
const THEME_COLOR = { light: '#ffffff', dark: '#1c1d1f' } as const;

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    // The phone's status bar (and the installed app's title bar) follows the chosen theme.
    for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      m.content = theme === 'auto' ? (m.dataset.auto ?? m.content) : THEME_COLOR[theme];
    }
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Not remembered: fine.
    }
  }, [theme]);
  const next = () => setTheme((t) => (t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto'));
  return [theme, next];
}

/** "#/plan/<id>" → the plan's id; anything else is the list. */
function useRoute(): [string | null, (id: string | null) => void] {
  const read = () => /^#\/plan\/([0-9a-f-]{36})$/i.exec(location.hash)?.[1] ?? null;
  const [id, setId] = useState<string | null>(read);
  useEffect(() => {
    const f = () => setId(read());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const go = (next: string | null) => {
    location.hash = next ? `#/plan/${next}` : '#/';
  };
  return [id, go];
}

type Gate = { s: 'checking' } | { s: 'error'; message: string } | Who;

export function App() {
  const [gate, setGate] = useState<Gate>({ s: 'checking' });
  const [theme, nextTheme] = useTheme();
  const [planId, go] = useRoute();
  const check = useCallback(() => {
    whoAmI()
      .then(setGate)
      .catch((e: unknown) => setGate({ s: 'error', message: e instanceof Error ? e.message : String(e) }));
  }, []);
  useEffect(() => {
    if (!authOn()) return;
    check();
    return onSignInChange(check);
  }, [check]);

  const access = gate.s === 'in' ? gate.access : null;
  const me = useMemo(() => (access ? { id: access.userId, name: access.name || access.email } : null), [access]);

  const themeButton = (
    <button type="button" className="btn btn--quiet" onClick={nextTheme} title="Light, dark, or as the computer is set">
      {theme === 'auto' ? 'Theme: auto' : theme === 'light' ? 'Theme: light' : 'Theme: dark'}
    </button>
  );

  if (!authOn()) return <Notice title="Lumora Planner" text="The Planner needs Lumora’s sign-in, which is not set up." />;
  if (gate.s === 'checking') return <Notice title="Lumora Planner" text="Checking your sign-in…" />;
  if (gate.s === 'error')
    return (
      <Notice title="Lumora Planner" text={gate.message}>
        <button type="button" className="btn" onClick={check}>
          Try again
        </button>
      </Notice>
    );
  if (gate.s === 'out') return <SignIn onDone={check} themeButton={themeButton} />;
  if (gate.s === 'denied')
    return (
      <Notice title="You can’t use the Planner yet" text={gate.why}>
        <p className="muted">Signed in as {gate.access.email}.</p>
        <button type="button" className="btn" onClick={() => void signOut()}>
          Sign out
        </button>
      </Notice>
    );

  return (
    <div className={planId ? 'app app--plan' : 'app'}>
      <header className="bar no-print">
        <a className="bar__brand" href="#/" onClick={() => go(null)}>
          <img src="./mark.svg" alt="" width="18" height="18" />
          Lumora Planner
        </a>
        <span className="bar__spacer" />
        <Clock />
        {themeButton}
        <span className="bar__who" title={gate.access.email}>
          {gate.access.name || gate.access.email}
        </span>
        <button type="button" className="btn btn--quiet" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      {planId && me ? <PlanView key={planId} planId={planId} me={me} onBack={() => go(null)} /> : <PlanList userId={gate.access.userId} onOpen={go} />}
    </div>
  );
}

/** The time now, to the second. */
export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="bar__clock" aria-label="Time now">
      {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}

function Notice({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <main className="gate">
      <div className="gate__box">
        <h1 className="gate__title">
          <img src="./mark.svg" alt="" width="20" height="20" />
          {title}
        </h1>
        <p>{text}</p>
        {children}
      </div>
    </main>
  );
}

function SignIn({ onDone, themeButton }: { onDone: () => void; themeButton: ReactNode }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    signIn(email, password)
      .then(onDone)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };
  return (
    <main className="gate">
      <form className="gate__box" onSubmit={submit}>
        <h1 className="gate__title">
          <img src="./mark.svg" alt="" width="20" height="20" />
          Lumora Planner
        </h1>
        <p className="muted">Plan the run of show with your team, then load it into Lumora’s cues. Sign in with your Lumora account.</p>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="warn">{error}</p>}
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <span className="bar__spacer" />
          {themeButton}
        </div>
        <p className="muted small">
          No account yet? Make one in the Lumora app (it opens with a sign-in), and the Lumora team approves it. The Planner is for accounts set up for Lumora.
        </p>
        <p className="muted small">
          <a href="../">Back to the Lumora website</a>
        </p>
      </form>
    </main>
  );
}
