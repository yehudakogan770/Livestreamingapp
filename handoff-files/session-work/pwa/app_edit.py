import sys
p = sys.argv[1]
s = open(p).read()


def rep(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)


rep("import { CalendarDays, ChevronsUpDown, CircleUserRound, LayoutList, LogOut, MessageSquare, Monitor, Moon, Sun } from 'lucide-react';",
    "import { CalendarDays, ChevronsUpDown, CircleUserRound, Download, LayoutList, LogOut, MessageSquare, Monitor, Moon, Sun } from 'lucide-react';")
rep("import { usePhone } from './touch';", """import { offlineWho, rememberPlans, rememberWho, savedPlans } from './offlineCache';
import { install, useInstall, useOnline } from './pwa';
import { InstallCard, IosSteps, OfflineBar } from './PwaBars';
import { usePhone } from './touch';
import { unreachable } from './usePlan';""")
rep("""function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => readRoute(location.hash));
  useEffect(() => {
    const f = () => setRoute(readRoute(location.hash));
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const go = useCallback((r: Route) => {
    location.hash = routeHash(r);
  }, []);
  return [route, go];
}""", """/**
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
}""")
rep("""function usePlans(on: boolean): { plans: PlanSummary[] | null; error: string; refresh: () => void } {
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => {
    setError('');
    listPlans(db())
      .then(setPlans)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    if (on) refresh();
  }, [on, refresh]);
  return { plans, error, refresh };
}""", """function usePlans(on: boolean): { plans: PlanSummary[] | null; error: string; refresh: () => Promise<void>; savedAt: number } {
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
}""")
rep("""  const [route, go] = useRoute();
  const phone = usePhone();
  const [unread, setUnread] = useState(0);
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
""", """  const [route, go, back] = useRoute();
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
""")
rep("""  const { plans, error: plansError, refresh } = usePlans(gate.s === 'in');""", """  const { plans, error: plansError, refresh, savedAt } = usePlans(gate.s === 'in' && !fromCopy);
  // From the copy: the saved list (usePlans does not ask the server).
  const copyPlans = useMemo(() => (fromCopy ? savedPlans() : null), [fromCopy]);""")
rep("""    if (gate.s === 'in' && page !== 'plan') refresh();""", """    if (gate.s === 'in' && !fromCopy && page !== 'plan') void refresh();""")
rep("""  const { canPlan } = gate;""", """  // Nothing is made or changed with no internet.
  const canPlan = gate.canPlan && !fromCopy;
  const shownPlans = copyPlans ? copyPlans.plans : plans;
  const offline = fromCopy || !online || savedAt > 0;""")
rep("""      refresh();
      go({ page: 'plan', id: p.id, tab: 'run' });""", """      void refresh();
      go({ page: 'plan', id: p.id, tab: 'run' });""")
rep("""        onBack={() => go({ page: 'plans' })}""", """        onBack={back}""")
rep("""  else if (route.page === 'account') content = <AccountPage name={gate.access.name} email={gate.access.email} theme={theme} setTheme={setTheme} />;""",
    """  else if (route.page === 'account')
    content = <AccountPage name={gate.access.name} email={gate.access.email} theme={theme} setTheme={setTheme} offer={installing.offer} />;""")
rep("""        <Calendar plans={plans} canPlan""", """        <Calendar plans={shownPlans} canPlan""")
rep("""      <PlanList plans={plans} error={plansError} onRefresh={refresh} email={gate.access.email} canPlan={canPlan} onOpen={open} onCreate={make} phone={phone} />""",
    """      <PlanList
        plans={shownPlans}
        error={plansError}
        onRefresh={fromCopy ? check : refresh}
        email={gate.access.email}
        canPlan={canPlan}
        onOpen={open}
        onCreate={make}
        phone={phone}
        top={installing.card && <InstallCard kind={installing.card} onClose={installing.dismiss} />}
      />""")
rep("""      {!phone && <Sidebar route={route} plans={plans} planId={planId} go={go} themeButton={themeButton} name={gate.access.name} email={gate.access.email} />}
      <div className="shell__main">{content}</div>
      {phone && <TabBar route={route} go={go} unread={unread} />}""", """      {!phone && (
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
      {phone && <TabBar route={route} go={go} back={back} unread={unread} />}""")
rep("""  name,
  email,
}: {
  route: Route;
  plans: PlanSummary[] | null;
  planId: string | null;
  go: (r: Route) => void;
  themeButton: ReactNode;
  name: string;
  email: string;
}) {""", """  name,
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
}) {""")
rep("""          <Account name={name} email={email} />""", """          <Account name={name} email={email} canInstall={canInstall} />""")
rep("""function TabBar({ route, go, unread }: { route: Route; go: (r: Route) => void; unread: number }) {""",
    """function TabBar({ route, go, back, unread }: { route: Route; go: (r: Route) => void; back: () => void; unread: number }) {""")
rep("""        inPlan && inPlan.tab === 'chat' ? go({ ...inPlan, tab: 'run' }) : go({ page: 'plans' }),""",
    """        inPlan && inPlan.tab === 'chat' ? go({ ...inPlan, tab: 'run' }) : inPlan ? back() : go({ page: 'plans' }),""")
rep("""function AccountPage({ name, email, theme, setTheme }: { name: string; email: string; theme: Theme; setTheme: (t: Theme) => void }) {""",
    """function AccountPage({
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
}) {""")
rep("""      <div className="group group--gap">
        <button type="button" className="group__row group__btn" onClick={() => void signOut()}>""", """      {offer === 'prompt' && (
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
        <button type="button" className="group__row group__btn" onClick={() => void signOut()}>""")
rep("""function Account({ name, email }: { name: string; email: string }) {""",
    """function Account({ name, email, canInstall }: { name: string; email: string; canInstall: boolean }) {""")
rep("""          <button type="button" role="menuitem" className="popover__item" onClick={() => void signOut()}>""", """          {canInstall && (
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
          <button type="button" role="menuitem" className="popover__item" onClick={() => void signOut()}>""")
open(p, 'w').write(s)
