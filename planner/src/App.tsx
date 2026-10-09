import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  CalendarDays,
  ChevronsUpDown,
  CircleUserRound,
  Download,
  LayoutList,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
} from 'lucide-react';
import { authOn } from '../../app/src/auth/config';
import { createPlan, listPlans } from './api';
import { upcoming } from './calDates';
import { PageHead, PlanList } from './PlanList';
import type { PlanTab } from './PlanView';
import { db, onSignInChange, signIn, signOut, signUp, signUpsOpen, whoAmI, type Who } from './session';
import { featureOn } from '../../app/src/auth/rules';
import { PlannerFeaturesCtx } from './features';
import { MIN_PASSWORD } from '../../app/src/auth/password';
import { Brand, Mark } from './Mark';
import { initials, isoDate, shortDate, showClock, type PlanSummary } from './model';
import { lastWho, offlineWho, rememberPlans, rememberWho, savedPlans, unreachable } from './offlineCache';
import { install, useInstall, useOnline } from './pwa';
import { InstallCard, IosSteps, OfflineBar } from './PwaBars';
import { useLayout, type Device } from './device';
import { listTemplates, myFeed, feedUrl, type TemplateSummary } from './apiPro';
import { NoticeBell, NoticeList, useNotices } from './Notices';
import { AUTH_KEY, AUTH_URL } from '../../app/src/auth/config';

// Loaded when first needed (the sign-in and the list come up sooner): a plan,
// the calendar, and the two-step code form. The installed app has them all on the device.
const loadPlanView = () => import('./PlanView');
const PlanView = lazy(() => loadPlanView().then((m) => ({ default: m.PlanView })));
const loadCalendar = () => import('./Calendar');
const Calendar = lazy(() => loadCalendar().then((m) => ({ default: m.Calendar })));
const PublicView = lazy(() => import('./PublicView').then((m) => ({ default: m.PublicView })));
const NewPlanDialog = lazy(() => import('./NewPlan').then((m) => ({ default: m.NewPlanDialog })));
const CodeForm = lazy(() => import('../../app/src/auth/TwoStep').then((m) => ({ default: m.CodeForm })));
const TwoStepSetup = lazy(() => import('../../app/src/auth/TwoStep').then((m) => ({ default: m.TwoStepSetup })));

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

export type Route =
  | { page: 'plans' }
  | { page: 'calendar' }
  | { page: 'account' }
  | { page: 'plan'; id: string; tab: PlanTab }
  | { page: 'view'; token: string; screen: '' | 'now' | 'timer' | 'prompter' };

/** "#/", "#/calendar", "#/account", "#/plan/<id>", "#/plan/<id>/schedule", "#/plan/<id>/chat", "#/view/<token>" (a public link)… */
export function readRoute(hash: string): Route {
  const plan = /^#\/plan\/([0-9a-f-]{36})(?:\/(run|schedule|chat|show|timer|prompter|crew|contacts|tasks|gear|budget|files))?$/i.exec(hash);
  if (plan) return { page: 'plan', id: plan[1]!, tab: (plan[2]?.toLowerCase() as PlanTab | undefined) ?? 'run' };
  const view = /^#\/view\/([0-9a-f-]{36})(?:\/(now|timer|prompter))?$/i.exec(hash);
  if (view) return { page: 'view', token: view[1]!.toLowerCase(), screen: (view[2]?.toLowerCase() as 'now' | 'timer' | 'prompter' | undefined) ?? '' };
  if (hash === '#/calendar') return { page: 'calendar' };
  if (hash === '#/account') return { page: 'account' };
  return { page: 'plans' };
}

export function routeHash(r: Route): string {
  if (r.page === 'plan') return `#/plan/${r.id}${r.tab === 'run' ? '' : `/${r.tab}`}`;
  if (r.page === 'view') return `#/view/${r.token}${r.screen ? `/${r.screen}` : ''}`;
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

/**
 * The plans you own or are on, for the list, the calendar and the sidebar.
 * Opening the app, the list kept on this device shows at once while the live
 * one loads (and again once the sign-in has been checked: `checked` changes).
 */
function usePlans(
  on: boolean,
  checked: number,
): { plans: PlanSummary[] | null; templates: TemplateSummary[]; error: string; refresh: () => Promise<void>; savedAt: number } {
  const [plans, setPlans] = useState<PlanSummary[] | null>(() => (on ? (savedPlans()?.plans ?? null) : null));
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [error, setError] = useState('');
  /** When the list shown was saved on this device (no internet), or 0: live. */
  const [savedAt, setSavedAt] = useState(0);
  const refresh = useCallback(
    () =>
      Promise.all([listPlans(db()), listTemplates(db())])
        .then(([all, temps]) => {
          // Templates are listed apart, not with the plans.
          const ids = new Set(temps.map((t) => t.id));
          const list = all.filter((p) => !ids.has(p.id));
          setTemplates(temps);
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
  }, [on, refresh, checked]);
  return { plans, templates, error, refresh, savedAt };
}

type Gate = { s: 'checking' } | { s: 'error'; message: string } | Who;

/**
 * Opening the app: signed in on this device before, it opens straight to your
 * plans as they were last time (then checks the sign-in with the server, and
 * goes on from there); otherwise it waits for that check.
 */
function firstGate(): Gate {
  if (!authOn() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { s: 'checking' };
  return lastWho() ?? { s: 'checking' };
}

export function App() {
  const [gate, setGate] = useState<Gate>(firstGate);
  /** Opened from what was kept on this device: the list loads again once the sign-in is checked (invitations may have been claimed). */
  const [checked, setChecked] = useState(0);
  const fromKept = useRef(gate.s === 'in');
  const [theme, nextTheme, setTheme] = useTheme();
  const [route, go, back] = useRoute();
  const layout = useLayout();
  const phone = layout.device === 'phone';
  // A narrow computer window, or a tablet held upright: the sidebar is a row of icons that opens over the page.
  const rail = layout.compact || (layout.device === 'tablet' && layout.orientation === 'portrait');
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
        if (fromKept.current) {
          fromKept.current = false;
          setChecked((n) => n + 1);
        }
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
  // The same object while it is the same person (each check of the sign-in makes a new `access`).
  const meId = access?.userId;
  const meName = access ? access.name || access.email : '';
  const me = useMemo(() => (meId ? { id: meId, name: meName } : null), [meId, meName]);
  const { plans, templates, error: plansError, refresh, savedAt } = usePlans(gate.s === 'in' && !fromCopy, checked);
  const [newPlan, setNewPlan] = useState<{ name: string; date: string } | null>(null);
  const notices = useNotices(gate.s === 'in' && !fromCopy ? (gate.access.userId ?? null) : null, (n) => {
    // A new mention or task while the app is in the background: the browser says so (if allowed).
    try {
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted')
        new Notification(n.kind === 'task' ? `${n.from || 'Someone'} gave you a task` : `${n.from || 'Someone'} mentioned you`, { body: n.body, tag: n.id });
    } catch {
      // No notifications here: the bell still shows it.
    }
  });
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
  // Signed in, once the page has settled: fetch the plan and calendar parts, so they open at once.
  const signedIn = gate.s === 'in';
  useEffect(() => {
    if (!signedIn) return;
    const t = setTimeout(() => {
      loadPlanView().catch(() => {});
      loadCalendar().catch(() => {});
    }, 2500);
    return () => clearTimeout(t);
  }, [signedIn]);

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

  if (route.page === 'view' && authOn())
    return (
      <Suspense fallback={<Loading />}>
        <PublicView token={route.token} screen={route.screen} go={(screen) => go({ page: 'view', token: route.token, screen })} />
      </Suspense>
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
          <Suspense fallback={null}>
            <CodeForm db={db()} onDone={check}>
              <div className="row">
                <button type="button" className="btn" onClick={() => void signOut()}>
                  Sign out
                </button>
              </div>
            </CodeForm>
          </Suspense>
        </div>
      </main>
    );
  if (gate.s === 'setup')
    return (
      <main className="gate">
        <div className="gate__box">
          <Brand />
          <h1 className="gate__title">Set up two-step sign-in</h1>
          <p className="muted">
            The Lumora team asks {gate.access.rules?.twoStep === 'team' ? 'its team accounts' : 'everyone'} to use two-step sign-in: a 6-digit code from an
            authenticator app on your phone, each time you sign in.
          </p>
          <Suspense fallback={null}>
            <TwoStepSetup db={db()} issuer="Lumora Planner" onDone={check} />
          </Suspense>
          <div className="row">
            <button type="button" className="btn" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </main>
    );
  if (gate.s === 'denied')
    return (
      <Notice title={gate.title ?? 'You can’t use the Planner yet'} text={gate.why}>
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
  const planName = (id: string) => (plans ?? []).find((p) => p.id === id)?.name ?? '';

  let content: ReactNode;
  if (route.page === 'plan' && me)
    content = (
      <Suspense fallback={<OpeningPlan onBack={back} />}>
        <PlanView
          key={route.id}
          planId={route.id}
          me={me}
          tab={route.tab}
          onTab={(tab) => go({ page: 'plan', id: route.id, tab })}
          onBack={back}
          onUnread={setUnread}
        />
      </Suspense>
    );
  else if (route.page === 'account')
    content = (
      <AccountPage name={gate.access.name} email={gate.access.email} theme={theme} setTheme={setTheme} offer={installing.offer} device={layout.device}>
        {notices.ready && (
          <>
            <h2 className="page__sub">Notifications</h2>
            <div className="group notices__page" onClick={() => setTimeout(notices.readAll, 500)}>
              <NoticeList store={notices} planName={planName} onOpen={(n) => go({ page: 'plan', id: n.planId, tab: n.kind === 'task' ? 'tasks' : 'run' })} />
            </div>
          </>
        )}
      </AccountPage>
    );
  else if (route.page === 'calendar')
    content = (
      <main className="page page--wide">
        <PageHead title="Calendar" mode="calendar" phone={phone} />
        {plansError && <p className="warn">{plansError}</p>}
        <Suspense fallback={null}>
          <Calendar plans={shownPlans} canPlan={canPlan} onOpen={open} onCreate={make} phone={phone} />
        </Suspense>
        {notices.ready && <CalendarFeed />}
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
        onNewFrom={(name) => setNewPlan({ name, date: '' })}
        templates={templates}
        phone={phone}
        top={installing.card && <InstallCard kind={installing.card} onClose={installing.dismiss} />}
      />
    );

  const planId = route.page === 'plan' ? route.id : null;
  const rules = gate.access.rules;
  return (
    <PlannerFeaturesCtx.Provider value={{ chat: featureOn(rules, 'planner_chat'), sharing: featureOn(rules, 'planner_sharing') }}>
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
            rail={rail}
            shortcuts={layout.device === 'computer'}
            bell={
              <NoticeBell
                store={notices}
                planName={planName}
                onOpen={(n) => go({ page: 'plan', id: n.planId, tab: n.kind === 'task' ? 'tasks' : 'run' })}
                label={!rail}
              />
            }
          />
        )}
        {newPlan && (
          <Suspense fallback={null}>
            <NewPlanDialog
              userId={gate.access.userId}
              initialName={newPlan.name}
              initialDate={newPlan.date}
              onBlank={(name, date) => make(name, date).then(() => setNewPlan(null))}
              onMade={(id) => {
                setNewPlan(null);
                void refresh();
                go({ page: 'plan', id, tab: 'run' });
              }}
              onClose={() => setNewPlan(null)}
            />
          </Suspense>
        )}
        <div className="shell__main">
          {offline && <OfflineBar fromCopy={fromCopy || savedAt > 0} at={copyPlans?.at ?? savedAt} />}
          {content}
        </div>
        {phone && <TabBar route={route} go={go} back={back} unread={unread} notices={notices.unread} />}
      </div>
    </PlannerFeaturesCtx.Provider>
  );
}

/**
 * Computers and tablets: the app's sidebar — the mark, where to go, what is
 * coming up, and the account. `rail`: a column of icons (a narrow computer
 * window, a tablet held upright) that opens the whole sidebar over the page.
 */
function Sidebar({
  route,
  plans,
  planId,
  go,
  themeButton,
  name,
  email,
  canInstall,
  rail,
  shortcuts,
  bell,
}: {
  bell?: ReactNode;
  route: Route;
  plans: PlanSummary[] | null;
  planId: string | null;
  go: (r: Route) => void;
  themeButton: ReactNode;
  name: string;
  email: string;
  canInstall: boolean;
  rail: boolean;
  shortcuts: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Going somewhere closes it; so does Esc.
  const where = routeHash(route);
  useEffect(() => setOpen(false), [where, rail]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  const today = isoDate(new Date());
  const soon = upcoming(plans ?? [], today, 8);
  // The open plan stays in the list even when it is past or has no date.
  const current = planId && !soon.some((p) => p.id === planId) ? (plans ?? []).find((p) => p.id === planId) : undefined;
  const Toggle = open ? PanelLeftClose : PanelLeftOpen;
  const side = (
    <nav className={`side no-print${rail ? (open ? ' side--over' : ' side--rail') : ''}`} aria-label="Planner">
      <div className="side__top">
        <a className="side__brand" href="#/" title="Lumora Planner">
          <Mark size={22} />
          <span className="side__text">Lumora Planner</span>
        </a>
        {rail && (
          <button
            type="button"
            className="btn btn--quiet btn--icon side__toggle"
            aria-expanded={open}
            aria-label={open ? 'Close the sidebar' : 'Open the sidebar'}
            title={open ? 'Close the sidebar' : 'Open the sidebar'}
            onClick={() => setOpen(!open)}
          >
            <Toggle size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="side__nav">
        <a className={`side__item${route.page === 'plans' ? ' is-on' : ''}`} href="#/" aria-current={route.page === 'plans' ? 'page' : undefined} title="Plans">
          <LayoutList size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="side__text">Plans</span>
          {plans && <span className="side__count">{plans.length}</span>}
        </a>
        <a
          className={`side__item${route.page === 'calendar' ? ' is-on' : ''}`}
          href="#/calendar"
          aria-current={route.page === 'calendar' ? 'page' : undefined}
          title="Calendar"
        >
          <CalendarDays size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="side__text">Calendar</span>
        </a>
        {bell && <div className="side__bell">{bell}</div>}
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
          <Account name={name} email={email} canInstall={canInstall} shortcuts={shortcuts} />
          {themeButton}
        </div>
      </div>
    </nav>
  );
  if (!rail) return side;
  // The rail keeps its place in the layout; the opened sidebar lies over the page.
  return (
    <div className="side__slot">
      {side}
      {open && <div className="scrim side__scrim no-print" onClick={() => setOpen(false)} aria-hidden="true" />}
    </div>
  );
}

/** What the keys do on a computer (the account menu lists them). */
export const SHORTCUTS: [string, string][] = [
  ['N', 'New cue'],
  ['↑ ↓', 'Move the selection'],
  ['Enter', 'Edit the selected cue'],
  ['Esc', 'Close the panel'],
  [/Mac|iPhone|iPad/.test(typeof navigator === 'undefined' ? '' : navigator.platform) ? '⌘P' : 'Ctrl+P', 'Print or save as PDF'],
];

/** Phones: the tab bar at the bottom. Chat shows while a plan is open. */
function TabBar({ route, go, back, unread, notices = 0 }: { route: Route; go: (r: Route) => void; back: () => void; unread: number; notices?: number }) {
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
      {tab(route.page === 'account', 'Account', <CircleUserRound size={22} strokeWidth={1.6} aria-hidden="true" />, () => go({ page: 'account' }), notices)}
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
  device = 'phone',
  children,
}: {
  children?: ReactNode;
  name: string;
  email: string;
  theme: Theme;
  setTheme: (t: Theme) => void;
  offer: 'ios' | 'prompt' | null;
  device?: Device;
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
      {children}
      <h2 className="page__sub">Appearance</h2>
      <div className="seg seg--block" role="group" aria-label="Theme">
        {(['auto', 'light', 'dark'] as const).map((t) => (
          <button key={t} type="button" className={`seg__btn${theme === t ? ' is-on' : ''}`} aria-pressed={theme === t} onClick={() => setTheme(t)}>
            {t === 'auto' ? `As the ${device}` : t === 'light' ? 'Light' : 'Dark'}
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

/** Your own calendar feed: every plan you are on, in Google Calendar, Outlook or Apple Calendar. */
function CalendarFeed() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const get = (fresh: boolean) =>
    myFeed(db(), fresh)
      .then((t) => setUrl(feedUrl(AUTH_URL, AUTH_KEY, 'planner_ical_me', t)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  return (
    <section className="feed" aria-label="Calendar feed">
      <h2 className="page__sub">Subscribe in your calendar</h2>
      {!url ? (
        <p className="muted small">
          Every plan you are on, with its schedule, in Google Calendar, Outlook or Apple Calendar, kept up to date.{' '}
          <button type="button" className="link" onClick={() => void get(false)}>
            Show my calendar link
          </button>
        </p>
      ) : (
        <>
          <div className="row">
            <input className="input grow mono small" value={url} readOnly onFocus={(e) => e.target.select()} aria-label="Calendar link" />
            <button
              type="button"
              className="btn"
              onClick={() =>
                void navigator.clipboard?.writeText(url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="muted small">
            In your calendar app choose “Add calendar → From URL” (Google) or “Subscribe” (Apple, Outlook), and paste it. Keep it private: anyone with it sees
            your plans’ names and times.{' '}
            <button type="button" className="link" onClick={() => confirm('Make a new link? The old one stops working.') && void get(true)}>
              Make a new link
            </button>
          </p>
        </>
      )}
      {error && <p className="warn small">{error}</p>}
    </section>
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
function Account({ name, email, canInstall, shortcuts }: { name: string; email: string; canInstall: boolean; shortcuts: boolean }) {
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
      <button
        type="button"
        className="account__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${name || email}`}
        onClick={() => setOpen(!open)}
        title={email}
      >
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
          {shortcuts && (
            <div className="keys" role="group" aria-label="Keyboard shortcuts">
              <div className="keys__head">Keyboard shortcuts</div>
              <dl className="keys__list">
                {SHORTCUTS.map(([k, what]) => (
                  <div key={what} className="keys__row">
                    <dt>{what}</dt>
                    <dd>
                      <kbd>{k}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
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

/** While a plan's part of the app loads: as the plan itself shows while it opens. */
function OpeningPlan({ onBack }: { onBack: () => void }) {
  return (
    <main className="page">
      <div className="empty empty--center empty--quiet">
        <Mark size={32} />
        <p className="muted">Opening the plan…</p>
        <button type="button" className="btn" onClick={onBack}>
          Back to plans
        </button>
      </div>
    </main>
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
  // New sign-ups closed by the Lumora team: only invited emails make an account (the server decides).
  const [open, setOpen] = useState(true);
  useEffect(() => {
    let live = true;
    void signUpsOpen().then((o) => live && setOpen(o));
    return () => {
      live = false;
    };
  }, []);
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
              : open
                ? 'For teammates: with an account, you see and work on the plans someone invites you to (by this email).'
                : 'New sign-ups are closed: use the email address you were invited with.'}
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
            {mode === 'in' ? (open ? 'Invited to a plan and no account yet? ' : 'Invited and no account yet? ') : 'Already have an account? '}
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

// Opened straight to a plan or the calendar: fetch that part now, alongside the rest.
if (typeof location !== 'undefined') {
  const first = readRoute(location.hash).page;
  if (first === 'plan') void loadPlanView();
  else if (first === 'calendar') void loadCalendar();
}
