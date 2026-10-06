import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CalendarDays, ChevronsUpDown, CircleUserRound, Download, LayoutList, LogOut, MessageSquare, Monitor, Moon, Sun } from 'lucide-react';
import { authOn } from '../../app/src/auth/config';
import { createPlan, listPlans } from './api';
import { Calendar } from './Calendar';
import { upcoming } from './calDates';
import { PageHead, PlanList } from './PlanList';
import { PlanView, type PlanTab } from './PlanView';
import { db, onSignInChange, signIn, signOut, signUp, whoAmI, type Who } from './session';
import { CodeForm } from '../../app/src/auth/TwoStep';
import { MIN_PASSWORD } from '../../app/src/auth/password';
import { initials } from './Inspector';
import { Brand, Mark } from './Mark';
import { isoDate, shortDate, showClock, type PlanSummary } from './model';
import { offlineWho, rememberPlans, rememberWho, savedPlans } from './offlineCache';
import { install, useInstall, useOnline } from './pwa';
import { InstallCard, IosSteps, OfflineBar } from './PwaBars';
import { usePhone } from './touch';
import { unreachable } from './usePlan';

type Theme = 'auto' | 'light' | 'dark';
const THEME_KEY = 'lumora.planner.theme';
const THEME_COLOR = { light: '#ffffff', dark: '#1c1c1b' } as const;
const THEME_WORDS = { auto: 'Theme: auto', light: 'Theme: light', dark: 'Theme: dark' } as const;

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

function useTheme(): [Theme, () => void, (t: Theme) => void] {
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
  return [theme, next, setTheme];
}

export type Route = { page: 'plans' } | { page: 'calendar' } | { page: 'account' } | { page: 'plan'; id: string; tab: PlanTab };

/** "#/", "#/calendar", "#/account", "#/plan/<id>", "#/plan/<id>/schedule", "#/plan/<id>/chat". */
export function readRoute(hash: string): Route {
  const plan = /^#\/plan\/([0-9a-f-]{36})(?:\/(run|schedule|chat))?$/i.exec(hash);
  if (plan) return { page: 'plan', id: plan[1]!, tab: (plan[2] as PlanTab | undefined) ?? 'run' };
  if (hash === '#/calendar') return { page: 'calendar' };
  if (hash === '#/account') return { page: 'account' };
  return { page: 'plans' };
}

export function routeHash(r: Route): string {
  if (r.page === 'plan') return `#/plan/${r.id}${r.tab === 'run' ? '' : `/${r.tab}`}`;
  return r.page === 'plans' ? '#/' : `#/${r.page}`;
}

/**
 * The pages visited in this app, oldest first, to go back the way the
 * browser's (and Android's) Back does. `hash` is where the app is now.
 */
export function visit(stack: readonly string[], hash: string): string[] {
  if (stack.length >= 2 && stack[stack.length - 2] === hash) return stack.slice(0, -1);
  if (stack.at(-1) === hash) return [...stack];
  return [...stack, hash].slice(-50);
}

/** How far back (history.go) to the last plans or calendar page, or 0 if it is not in this visit. */
export function stepsBackToList(stack: readonly string[]): number {
  for (let i = stack.length - 2; i >= 0; i--) if (readRoute(stack[i]!).page !== 'plan') return i - (stack.length - 1);
  return 0;
}

function useRoute(): [Route, (r: Route) => void, () => void] {
  const [route, setRoute] = useState<Route>(() => readRoute(location.hash));
  const stack = useRef<string[]>([location.hash || '#/']);
  useEffect(() => {
    const f = () => {
      stack.current = visit(stack.current, location.hash || '#/');
      setRoute(readRoute(location.hash));
    };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const go = useCallback((r: Route) => {
    location.hash = routeHash(r);
  }, []);
  // Leaving a plan: back through history to the list it was opened from (so
  // Back does not return to the plan), or, opened straight from a link, to the list.
  const back = useCallback(() => {
    const n = stepsBackToList(stack.current);
    if (n < 0) history.go(n);
    else location.replace('#/');
  }, []);
  return [route, go, back];
}

/** The plans you own or are on, for the list, the calendar and the sidebar. */
function usePlans(on: boolean): { plans: PlanSummary[] | null; error: string; refresh: () => Promise<void>; savedAt: number } {
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState('');
  /** When the list shown was saved on this device (no internet), or 0: live. */
  const [savedAt, setSavedAt] = useState(0);
  const refresh = useCallback(
    () =>
      listPlans(db())
        .then((list) => {
          setPlans(list);
          setError('');
          setSavedAt(0);
          rememberPlans(list);
        })
        .catch((e: unknown) => {
          const copy = unreachable(e) ? savedPlans() : null;
          if (copy) {
            setPlans(copy.plans);
            setSavedAt(copy.at);
            setError('');
          } else setError(e instanceof Error ? e.message : String(e));
        }),
    [],
  );
  useEffect(() => {
    if (on) void refresh();
  }, [on, refresh]);
  return { plans, error, refresh, savedAt };
}

type Gate = { s: 'checking' } | { s: 'error'; message: string } | Who;

export function App() {
  const [gate, setGate] = useState<Gate>({ s: 'checking' });
  const [theme, nextTheme, setTheme] = useTheme();
  const [route, go, back] = useRoute();
  const phone = usePhone();
  const online = useOnline();
  const installing = useInstall();
  const [unread, setUnread] = useState(0);
  const check = useCallback(() => {
    // No internet: straight to the copy of the plans kept on this device.
    const copy = navigator.onLine === false ? offlineWho() : null;
    if (copy) return setGate(copy);
    whoAmI()
      .then((who) => {
        if (who.s === 'in') rememberWho(who);
        setGate(who);
      })
      .catch((e: unknown) => {
        const saved = unreachable(e) ? offlineWho() : null;
        setGate(saved ?? { s: 'error', message: e instanceof Error ? e.message : String(e) });
      });
  }, []);
  useEffect(() => {
    if (!authOn()) return;
    check();
    return onSignInChange(check);
  }, [check]);
  // Back online after opening the copy: check the sign-in and load everything live.
  const fromCopy = gate.s === 'in' && gate.access.offline === true;
  useEffect(() => {
    if (online && fromCopy) check();
  }, [online, fromCopy, check]);

  const access = gate.s === 'in' ? gate.access : null;
  const me = useMemo(() => (access ? { id: access.userId, name: access.name || access.email } : null), [access]);
  const { plans, error: plansError, refresh, savedAt } = usePlans(gate.s === 'in' && !fromCopy);
  // From the copy: the saved list (usePlans does not ask the server).
  const copyPlans = useMemo(() => (fromCopy ? savedPlans() : null), [fromCopy]);
  // Back on the list or calendar: names and dates may have changed in a plan.
  const page = route.page;
  const firstPage = useRef(true);
  useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    if (gate.s === 'in' && !fromCopy && page !== 'plan') void refresh();
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (page !== 'plan') setUnread(0);
  }, [page]);

  const ThemeIcon = theme === 'auto' ? Monitor : theme === 'light' ? Sun : Moon;
  const themeButton = (
    <button
      type="button"
      className="btn btn--quiet btn--theme"
      onClick={nextTheme}
      title="Light, dark, or as the computer is set"
      aria-label={THEME_WORDS[theme]}
    >
      <ThemeIcon size={15} strokeWidth={1.75} aria-hidden="true" />
      <span className="btn__label">{THEME_WORDS[theme]}</span>
    </button>
  );

  if (!authOn()) return <Notice title="Lumora Planner" text="The Planner needs Lumora’s sign-in, which is not set up." />;
  if (gate.s === 'checking') return <Loading />;
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

  // Nothing is made or changed with no internet.
  const canPlan = gate.canPlan && !fromCopy;
  const shownPlans = copyPlans ? copyPlans.plans : plans;
  const offline = fromCopy || !online || savedAt > 0;
  const make = (name: string, date: string) =>
    createPlan(db(), name || 'Untitled plan', gate.access.userId, date).then((p) => {
      void refresh();
      go({ page: 'plan', id: p.id, tab: 'run' });
    });
  const open = (id: string) => go({ page: 'plan', id, tab: 'run' });

  let content: ReactNode;
  if (route.page === 'plan' && me)
    content = (
      <PlanView
        key={route.id}
        planId={route.id}
        me={me}
        tab={route.tab}
        onTab={(tab) => go({ page: 'plan', id: route.id, tab })}
        onBack={back}
        onUnread={setUnread}
      />
    );
  else if (route.page === 'account')
    content = <AccountPage name={gate.access.name} email={gate.access.email} theme={theme} setTheme={setTheme} offer={installing.offer} />;
  else if (route.page === 'calendar')
    content = (
      <main className="page page--wide">
        <PageHead title="Calendar" mode="calendar" phone={phone} />
        {plansError && <p className="warn">{plansError}</p>}
        <Calendar plans={shownPlans} canPlan={canPlan} onOpen={open} onCreate={make} phone={phone} />
      </main>
    );
  else
    content = (
      <PlanList
        plans={shownPlans}
        error={plansError}
        onRefresh={fromCopy ? check : refresh}
        email={gate.access.email}
        canPlan={canPlan}
        onOpen={open}
        onCreate={make}
        phone={phone}
        top={installing.card && <InstallCard kind={installing.card} onClose={installing.dismiss} />}
      />
    );

  const planId = route.page === 'plan' ? route.id : null;
  return (
    <div className={`shell${route.page === 'plan' ? ' shell--plan' : ''}`}>
      {!phone && (
        <Sidebar
          route={route}
          plans={shownPlans}
          planId={planId}
          go={go}
          themeButton={themeButton}
          name={gate.access.name}
          email={gate.access.email}
          canInstall={installing.offer === 'prompt'}
        />
      )}
      <div className="shell__main">
        {offline && <OfflineBar fromCopy={fromCopy || savedAt > 0} at={copyPlans?.at ?? savedAt} />}
        {content}
      </div>
      {phone && <TabBar route={route} go={go} back={back} unread={unread} />}
    </div>
  );
}

/** Desktop: the app's sidebar — the mark, where to go, what is coming up, and the account. */
function Sidebar({
  route,
  plans,
  planId,
  go,
  themeButton,
  name,
  email,
  canInstall,
}: {
  route: Route;
  plans: PlanSummary[] | null;
  planId: string | null;
  go: (r: Route) => void;
  themeButton: ReactNode;
  name: string;
  email: string;
  canInstall: boolean;
}) {
  const today = isoDate(new Date());
  const soon = upcoming(plans ?? [], today, 8);
  // The open plan stays in the list even when it is past or has no date.
  const current = planId && !soon.some((p) => p.id === planId) ? (plans ?? []).find((p) => p.id === planId) : undefined;
  return (
    <nav className="side no-print" aria-label="Planner">
      <a className="side__brand" href="#/">
        <Mark size={22} />
        <span>Lumora Planner</span>
      </a>
      <div className="side__nav">
        <a className={`side__item${route.page === 'plans' ? ' is-on' : ''}`} href="#/" aria-current={route.page === 'plans' ? 'page' : undefined}>
          <LayoutList size={16} strokeWidth={1.75} aria-hidden="true" />
          Plans
          {plans && <span className="side__count">{plans.length}</span>}
        </a>
        <a className={`side__item${route.page === 'calendar' ? ' is-on' : ''}`} href="#/calendar" aria-current={route.page === 'calendar' ? 'page' : undefined}>
          <CalendarDays size={16} strokeWidth={1.75} aria-hidden="true" />
          Calendar
        </a>
      </div>
      <div className="side__group">
        <h2 className="side__label">Upcoming</h2>
        {plans === null && <p className="side__none">Loading…</p>}
        {plans !== null && soon.length === 0 && !current && <p className="side__none">Nothing coming up</p>}
        <ul className="side__plans">
          {[...(current ? [current] : []), ...soon].map((p) => (
            <li key={p.id}>
              <a
                className={`side__plan${planId === p.id ? ' is-on' : ''}`}
                href={`#/plan/${p.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  go({ page: 'plan', id: p.id, tab: 'run' });
                }}
                aria-current={planId === p.id ? 'page' : undefined}
              >
                <span className="side__plan-name">{p.name || 'Untitled plan'}</span>
                <span className="side__plan-when">
                  {[shortDate(p.eventDate).replace(/, \d{4}$/, '') || 'No date', showClock(p.startTime)].filter(Boolean).join(' · ')}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div className="side__foot">
        <Clock />
        <div className="side__row">
          <Account name={name} email={email} canInstall={canInstall} />
          {themeButton}
        </div>
      </div>
    </nav>
  );
}

/** Phones: the tab bar at the bottom. Chat shows while a plan is open. */
function TabBar({ route, go, back, unread }: { route: Route; go: (r: Route) => void; back: () => void; unread: number }) {
  const inPlan = route.page === 'plan' ? route : null;
  const tab = (on: boolean, label: string, icon: ReactNode, onClick: () => void, badge = 0) => (
    <button type="button" className={`tabbar__btn${on ? ' is-on' : ''}`} aria-current={on ? 'page' : undefined} onClick={onClick}>
      <span className="tabbar__icon">
        {icon}
        {badge > 0 && (
          <span className="tabbar__badge" aria-label={`${badge} unread`}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      {label}
    </button>
  );
  return (
    <nav className="tabbar no-print" aria-label="Planner">
      {tab(route.page === 'plans' || (!!inPlan && inPlan.tab !== 'chat'), 'Plans', <LayoutList size={22} strokeWidth={1.6} aria-hidden="true" />, () =>
        inPlan && inPlan.tab === 'chat' ? go({ ...inPlan, tab: 'run' }) : inPlan ? back() : go({ page: 'plans' }),
      )}
      {tab(route.page === 'calendar', 'Calendar', <CalendarDays size={22} strokeWidth={1.6} aria-hidden="true" />, () => go({ page: 'calendar' }))}
      {inPlan &&
        tab(inPlan.tab === 'chat', 'Chat', <MessageSquare size={22} strokeWidth={1.6} aria-hidden="true" />, () => go({ ...inPlan, tab: 'chat' }), unread)}
      {tab(route.page === 'account', 'Account', <CircleUserRound size={22} strokeWidth={1.6} aria-hidden="true" />, () => go({ page: 'account' }))}
    </nav>
  );
}

/** Phones: who is signed in, the theme, and Sign out. */
function AccountPage({
  name,
  email,
  theme,
  setTheme,
  offer,
}: {
  name: string;
  email: string;
  theme: Theme;
  setTheme: (t: Theme) => void;
  offer: 'ios' | 'prompt' | null;
}) {
  return (
    <main className="page">
      <PageHead title="Account" />
      <div className="group">
        <div className="group__row person">
          <span className="avatar avatar--lg" aria-hidden="true">
            {initials(name || email)}
          </span>
          <span className="person__id">
            <b>{name || email}</b>
            {name && <span className="muted small">{email}</span>}
          </span>
        </div>
      </div>
      <h2 className="page__sub">Appearance</h2>
      <div className="seg seg--block" role="group" aria-label="Theme">
        {(['auto', 'light', 'dark'] as const).map((t) => (
          <button key={t} type="button" className={`seg__btn${theme === t ? ' is-on' : ''}`} aria-pressed={theme === t} onClick={() => setTheme(t)}>
            {t === 'auto' ? 'As the phone' : t === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
      </div>
      {offer === 'prompt' && (
        <div className="group group--gap">
          <button type="button" className="group__row group__btn group__btn--plain" onClick={() => void install()}>
            <Download size={18} strokeWidth={1.75} aria-hidden="true" />
            Install app
          </button>
        </div>
      )}
      {offer === 'ios' && (
        <>
          <h2 className="page__sub">Put the Planner on your home screen</h2>
          <div className="group">
            <div className="group__row">
              <IosSteps />
            </div>
          </div>
        </>
      )}
      <div className="group group--gap">
        <button type="button" className="group__row group__btn" onClick={() => void signOut()}>
          <LogOut size={18} strokeWidth={1.75} aria-hidden="true" />
          Sign out
        </button>
      </div>
      <p className="muted small page__foot">
        <Mark size={16} /> Lumora Planner · <a href="../">The Lumora website</a>
      </p>
    </main>
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
    <span className="side__clock" aria-label="Time now">
      {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}

/** Who is signed in, and Sign out, behind their initials. */
function Account({ name, email, canInstall }: { name: string; email: string; canInstall: boolean }) {
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
        <span className="account__who">{name || email}</span>
        <ChevronsUpDown size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && (
        <div className="popover account__menu" role="menu" aria-label="Account">
          <div className="account__id">
            <b>{name || email}</b>
            {name && <span className="muted small">{email}</span>}
          </div>
          {canInstall && (
            <button
              type="button"
              role="menuitem"
              className="popover__item"
              onClick={() => {
                setOpen(false);
                void install();
              }}
            >
              <Download size={15} strokeWidth={1.75} aria-hidden="true" />
              Install app
            </button>
          )}
          <button type="button" role="menuitem" className="popover__item" onClick={() => void signOut()}>
            <LogOut size={15} strokeWidth={1.75} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** While the sign-in is checked: the mark, as the page itself shows before the app loads. */
function Loading() {
  return (
    <main className="loading" aria-busy="true">
      <Mark size={40} />
      <span className="loading__name">Lumora Planner</span>
      <span className="muted small">Checking your sign-in…</span>
    </main>
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
            Every cue in order, the crew’s schedule for the day, and a chat for the whole team. Everyone edits the same plan live, and Lumora loads it as cues
            on show day.
          </p>
        </div>
        <SheetPreview />
      </section>
      <div className="signin__side">
        <div className="signin__theme">{themeButton}</div>
        <form className="signin__form" onSubmit={submit}>
          <div className="signin__brand">
            <Mark size={40} />
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
          {mode === 'new' && (
            <p className="muted small">
              By creating an account, you agree to the{' '}
              <a href="../terms.html" target="_blank" rel="noopener">
                Terms of Use
              </a>{' '}
              and{' '}
              <a href="../privacy.html" target="_blank" rel="noopener">
                Privacy Policy
              </a>
              .
            </p>
          )}
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
          {mode === 'in' && (
            <p className="muted small">
              <a href="../terms.html">Terms of Use</a> · <a href="../privacy.html">Privacy Policy</a>
            </p>
          )}
        </form>
      </div>
    </main>
  );
}

const PREVIEW: [string, string, string, string, string, boolean?][] = [
  ['8:55 AM', '5:00', 'Countdown', 'Countdown to start', 'Graphics'],
  ['9:00 AM', '1:00', 'Camera shot', 'Wide of the room', 'Cam 1'],
  ['9:01 AM', '7:00', 'Speaker', 'Welcome and agenda', 'Host', true],
  ['9:08 AM', '1:00', 'Title / name', 'Keynote speaker name', 'Graphics'],
  ['9:09 AM', '25:00', 'Speaker', 'Opening keynote', 'Cam 2'],
  ['9:34 AM', '4:00', 'Video', 'Sponsor video', 'Playback'],
];

/** A small, static picture of a cue sheet (real markup, not an image) beside the sign-in form. */
function SheetPreview() {
  return (
    <div className="preview" aria-hidden="true">
      <div className="preview__head">
        <Mark size={16} />
        <b>Annual conference, day 1</b>
        <span className="muted">Oct 6 · Main stage</span>
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
          Total <b className="mono">43:00</b>
        </span>
        <span>
          Ends <b className="mono">9:38 AM</b>
        </span>
      </div>
    </div>
  );
}
