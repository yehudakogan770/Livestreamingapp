import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { authOn } from '../../app/src/auth/config';
import { PlanList } from './PlanList';
import { PlanView } from './PlanView';
import { db, onSignInChange, signIn, signOut, signUp, whoAmI, type Who } from './session';
import { CodeForm } from '../../app/src/auth/TwoStep';
import { MIN_PASSWORD } from '../../app/src/auth/password';

type Theme = 'auto' | 'light' | 'dark';
const THEME_KEY = 'lumora.planner.theme';
const THEME_COLOR = { light: '#ffffff', dark: '#1d1d1c' } as const;

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
  if (gate.s === 'code')
    return (
      <main className="gate">
        <div className="gate__box">
          <CodeForm db={db()} onDone={check}>
            <div className="row">
              <button type="button" className="btn" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </CodeForm>
        </div>
      </main>
    );
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
      {planId && me ? (
        <PlanView key={planId} planId={planId} me={me} onBack={() => go(null)} />
      ) : (
        <PlanList userId={gate.access.userId} email={gate.access.email} canPlan={gate.canPlan} onOpen={go} />
      )}
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
  const [mode, setMode] = useState<'in' | 'new'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNote('');
    const go =
      mode === 'in'
        ? signIn(email, password).then(onDone)
        : signUp(name, email, password).then((inNow) => {
            if (inNow) onDone();
            else setNote('Account made. Check your email and click the link to confirm it, then sign in here.');
          });
    go.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setBusy(false));
  };
  return (
    <main className="gate">
      <form className="gate__box" onSubmit={submit}>
        <h1 className="gate__title">
          <img src="./mark.svg" alt="" width="20" height="20" />
          {mode === 'in' ? 'Lumora Planner' : 'Make a Planner account'}
        </h1>
        <p className="muted">
          {mode === 'in'
            ? 'Plan the run of show with your team, then load it into Lumora’s cues. Sign in with your Lumora account.'
            : 'For teammates: with an account, you see and work on the plans someone invites you to (by this email).'}
        </p>
        {mode === 'new' && (
          <label className="field">
            <span>Your name</span>
            <input autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            minLength={mode === 'in' ? undefined : MIN_PASSWORD}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {mode === 'new' && <p className="muted small">At least {MIN_PASSWORD} characters, with letters and numbers.</p>}
        {error && <p className="warn">{error}</p>}
        {note && <p>{note}</p>}
        <div className="row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create my account'}
          </button>
          <span className="bar__spacer" />
          {themeButton}
        </div>
        <p className="muted small">
          {mode === 'in' ? 'Invited to a plan and no account yet? ' : 'Already have an account? '}
          <button
            type="button"
            className="link"
            onClick={() => {
              setMode(mode === 'in' ? 'new' : 'in');
              setError('');
              setNote('');
            }}
          >
            {mode === 'in' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
        <p className="muted small">
          To make plans of your own, use an account the Lumora team has set up for Lumora. <a href="../">Back to the Lumora website</a>
        </p>
      </form>
    </main>
  );
}
