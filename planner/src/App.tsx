import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { authOn } from '../../app/src/auth/config';
import { PlanList } from './PlanList';
import { PlanView } from './PlanView';
import { db, onSignInChange, signIn, signOut, signUp, whoAmI, type Who } from './session';
import { CodeForm } from '../../app/src/auth/TwoStep';
import { MIN_PASSWORD } from '../../app/src/auth/password';
import { initials } from './Inspector';

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

  const ThemeIcon = theme === 'auto' ? Monitor : theme === 'light' ? Sun : Moon;
  const themeButton = (
    <button
      type="button"
      className="btn btn--quiet btn--theme"
      onClick={nextTheme}
      title="Light, dark, or as the computer is set"
      aria-label={theme === 'auto' ? 'Theme: auto' : theme === 'light' ? 'Theme: light' : 'Theme: dark'}
    >
      <ThemeIcon size={15} strokeWidth={1.75} aria-hidden="true" />
      <span className="btn__label">{theme === 'auto' ? 'Theme: auto' : theme === 'light' ? 'Theme: light' : 'Theme: dark'}</span>
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
          <Brand />
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
          <img src="./mark.svg" alt="" width="20" height="20" />
          Lumora Planner
        </a>
        <span className="bar__spacer" />
        <Clock />
        <span className="bar__div" aria-hidden="true" />
        {themeButton}
        <Account name={gate.access.name} email={gate.access.email} />
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

/** Who is signed in, and Sign out, behind their initials. */
function Account({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="account" ref={box}>
      <button type="button" className="account__btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title={email}>
        <span className="avatar" aria-hidden="true">
          {initials(name || email)}
        </span>
        <span className="bar__who">{name || email}</span>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <div className="popover account__menu" role="menu" aria-label="Account">
          <div className="account__id">
            <b>{name || email}</b>
            {name && <span className="muted small">{email}</span>}
          </div>
          <button type="button" role="menuitem" className="popover__item" onClick={() => void signOut()}>
            <LogOut size={15} strokeWidth={1.75} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Brand() {
  return (
    <div className="brand">
      <img src="./mark.svg" alt="" width="22" height="22" />
      Lumora Planner
    </div>
  );
}

function Notice({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <main className="gate">
      <div className="gate__box">
        <Brand />
        <h1 className="gate__title">{title}</h1>
        <p className="muted">{text}</p>
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
    <main className="signin">
      <section className="signin__about" aria-label="About the Planner">
        <Brand />
        <div className="signin__pitch">
          <h2>The run of show, planned together.</h2>
          <p>
            Every cue in order, with who runs it, how long it takes and when it starts. Your team edits the same sheet live, and Lumora loads it as cues on show
            day.
          </p>
        </div>
        <SheetPreview />
      </section>
      <div className="signin__side">
        <div className="signin__theme">{themeButton}</div>
        <form className="signin__form" onSubmit={submit}>
          <div className="signin__brand">
            <Brand />
          </div>
          <h1 className="gate__title">{mode === 'in' ? 'Sign in to Lumora Planner' : 'Make a Planner account'}</h1>
          <p className="muted">
            {mode === 'in'
              ? 'Plan the run of show with your team, then load it into Lumora’s cues. Sign in with your Lumora account.'
              : 'For teammates: with an account, you see and work on the plans someone invites you to (by this email).'}
          </p>
          {mode === 'new' && (
            <label className="field">
              <span>Your name</span>
              <input className="input" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="input"
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
          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create my account'}
          </button>
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
      </div>
    </main>
  );
}

const PREVIEW: [string, string, string, string, string, boolean?][] = [
  ['7:25 PM', '5:00', 'Countdown', 'Countdown to start', 'Graphics'],
  ['7:30 PM', '1:00', 'Camera shot', 'Wide of the hall', 'Cam 1'],
  ['7:31 PM', '7:00', 'Song lyrics', 'Opening song', 'Worship team', true],
  ['7:38 PM', '5:00', 'Speaker', 'Welcome', 'Host'],
  ['7:43 PM', '1:00', 'Title / name', 'Speaker name', 'Graphics'],
  ['7:44 PM', '4:00', 'Video', 'Feature video', 'Playback'],
];

/** A small, static picture of a cue sheet (real markup, not an image) beside the sign-in form. */
function SheetPreview() {
  return (
    <div className="preview" aria-hidden="true">
      <div className="preview__head">
        <b>Sunday evening service</b>
        <span className="muted">Oct 6 · Main hall</span>
        <span className="bar__spacer" />
        <span className="preview__live">
          <i className="tally" /> On now
        </span>
      </div>
      <table className="preview__table">
        <thead>
          <tr>
            <th>Start</th>
            <th>Length</th>
            <th>Type</th>
            <th>Cue</th>
            <th>Who</th>
          </tr>
        </thead>
        <tbody>
          {PREVIEW.map(([t, len, type, cue, who, now]) => (
            <tr key={cue} className={now ? 'is-now' : ''}>
              <td className="mono">{t}</td>
              <td className="mono">{len}</td>
              <td className="muted">{type}</td>
              <td>
                <b>{cue}</b>
              </td>
              <td className="muted">{who}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="preview__foot">
        <span>6 cues</span>
        <span>
          Total <b className="mono">23:00</b>
        </span>
        <span>
          Ends <b className="mono">7:48 PM</b>
        </span>
      </div>
    </div>
  );
}
