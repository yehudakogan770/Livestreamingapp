import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

P = 'planner/src/App.tsx'
apply(P, [
("""import { useLayout, type Device } from './device';
""",
"""import { useLayout, type Device } from './device';
import { listTemplates, myFeed, feedUrl, type TemplateSummary } from './apiPro';
import { NoticeBell, useNotices } from './Notices';
import { AUTH_KEY, AUTH_URL } from '../../app/src/auth/config';
"""),
("""const CodeForm = lazy(""",
"""const PublicView = lazy(() => import('./PublicView').then((m) => ({ default: m.PublicView })));
const NewPlanDialog = lazy(() => import('./NewPlan').then((m) => ({ default: m.NewPlanDialog })));
const CodeForm = lazy("""),
("""export type Route = { page: 'plans' } | { page: 'calendar' } | { page: 'account' } | { page: 'plan'; id: string; tab: PlanTab };

/** "#/", "#/calendar", "#/account", "#/plan/<id>", "#/plan/<id>/schedule", "#/plan/<id>/chat". */
export function readRoute(hash: string): Route {
  const plan = /^#\\/plan\\/([0-9a-f-]{36})(?:\\/(run|schedule|chat))?$/i.exec(hash);
  if (plan) return { page: 'plan', id: plan[1]!, tab: (plan[2] as PlanTab | undefined) ?? 'run' };""",
"""export type Route =
  | { page: 'plans' }
  | { page: 'calendar' }
  | { page: 'account' }
  | { page: 'plan'; id: string; tab: PlanTab }
  | { page: 'view'; token: string; screen: '' | 'now' | 'timer' | 'prompter' };

/** "#/", "#/calendar", "#/account", "#/plan/<id>", "#/plan/<id>/schedule", "#/plan/<id>/chat", "#/view/<token>" (a public link)… */
export function readRoute(hash: string): Route {
  const plan = /^#\\/plan\\/([0-9a-f-]{36})(?:\\/(run|schedule|chat|show|timer|prompter|crew|contacts|tasks|gear|budget|files))?$/i.exec(hash);
  if (plan) return { page: 'plan', id: plan[1]!, tab: (plan[2]?.toLowerCase() as PlanTab | undefined) ?? 'run' };
  const view = /^#\\/view\\/([0-9a-f-]{36})(?:\\/(now|timer|prompter))?$/i.exec(hash);
  if (view) return { page: 'view', token: view[1]!.toLowerCase(), screen: (view[2]?.toLowerCase() as 'now' | 'timer' | 'prompter' | undefined) ?? '' };"""),
("""  if (r.page === 'plan') return `#/plan/${r.id}${r.tab === 'run' ? '' : `/${r.tab}`}`;""",
"""  if (r.page === 'plan') return `#/plan/${r.id}${r.tab === 'run' ? '' : `/${r.tab}`}`;
  if (r.page === 'view') return `#/view/${r.token}${r.screen ? `/${r.screen}` : ''}`;"""),
# usePlans: templates kept apart
("""function usePlans(on: boolean, checked: number): { plans: PlanSummary[] | null; error: string; refresh: () => Promise<void>; savedAt: number } {
  const [plans, setPlans] = useState<PlanSummary[] | null>(() => (on ? (savedPlans()?.plans ?? null) : null));""",
"""function usePlans(
  on: boolean,
  checked: number,
): { plans: PlanSummary[] | null; templates: TemplateSummary[]; error: string; refresh: () => Promise<void>; savedAt: number } {
  const [plans, setPlans] = useState<PlanSummary[] | null>(() => (on ? (savedPlans()?.plans ?? null) : null));
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);"""),
("""      listPlans(db())
        .then((list) => {
          setPlans(list);""",
"""      Promise.all([listPlans(db()), listTemplates(db())])
        .then(([all, temps]) => {
          // Templates are listed apart, not with the plans.
          const ids = new Set(temps.map((t) => t.id));
          const list = all.filter((p) => !ids.has(p.id));
          setTemplates(temps);
          setPlans(list);"""),
("""  return { plans, error, refresh, savedAt };
}""",
"""  return { plans, templates, error, refresh, savedAt };
}"""),
("""  const { plans, error: plansError, refresh, savedAt } = usePlans(gate.s === 'in' && !fromCopy, checked);""",
"""  const { plans, templates, error: plansError, refresh, savedAt } = usePlans(gate.s === 'in' && !fromCopy, checked);
  const [newPlan, setNewPlan] = useState<{ name: string; date: string } | null>(null);
  const notices = useNotices(gate.s === 'in' && !fromCopy ? (gate.access.userId ?? null) : null, (n) => {
    // A new mention or task while the app is in the background: the browser says so (if allowed).
    try {
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted')
        new Notification(n.kind === 'task' ? `${n.from || 'Someone'} gave you a task` : `${n.from || 'Someone'} mentioned you`, { body: n.body, tag: n.id });
    } catch {
      // No notifications here: the bell still shows it.
    }
  });"""),
# The public page: before anything about signing in.
("""  if (!authOn()) return <Notice title="Lumora Planner" text="The Planner needs Lumora’s sign-in, which is not set up." />;""",
"""  if (route.page === 'view' && authOn())
    return (
      <Suspense fallback={<Loading />}>
        <PublicView token={route.token} screen={route.screen} go={(screen) => go({ page: 'view', token: route.token, screen })} />
      </Suspense>
    );
  if (!authOn()) return <Notice title="Lumora Planner" text="The Planner needs Lumora’s sign-in, which is not set up." />;"""),
("""  const open = (id: string) => go({ page: 'plan', id, tab: 'run' });""",
"""  const open = (id: string) => go({ page: 'plan', id, tab: 'run' });
  const planName = (id: string) => (plans ?? []).find((p) => p.id === id)?.name ?? '';"""),
("""        onOpen={open}
        onCreate={make}
        phone={phone}
        top={installing.card && <InstallCard kind={installing.card} onClose={installing.dismiss} />}
      />
    );""",
"""        onOpen={open}
        onCreate={make}
        onNewFrom={(name) => setNewPlan({ name, date: '' })}
        templates={templates}
        phone={phone}
        top={installing.card && <InstallCard kind={installing.card} onClose={installing.dismiss} />}
      />
    );"""),
("""          <Calendar plans={shownPlans} canPlan={canPlan} onOpen={open} onCreate={make} phone={phone} />
        </Suspense>""",
"""          <Calendar plans={shownPlans} canPlan={canPlan} onOpen={open} onCreate={make} phone={phone} />
        </Suspense>
        <CalendarFeed />"""),
("""            canInstall={installing.offer === 'prompt'}
            rail={rail}
            shortcuts={layout.device === 'computer'}
          />
        )}""",
"""            canInstall={installing.offer === 'prompt'}
            rail={rail}
            shortcuts={layout.device === 'computer'}
            bell={<NoticeBell store={notices} planName={planName} onOpen={(n) => go({ page: 'plan', id: n.planId, tab: n.kind === 'task' ? 'tasks' : 'run' })} label={!rail} />}
          />
        )}
        {phone && notices.ready && route.page !== 'plan' && (
          <div className="phone-bell no-print">
            <NoticeBell store={notices} planName={planName} onOpen={(n) => go({ page: 'plan', id: n.planId, tab: n.kind === 'task' ? 'tasks' : 'run' })} />
          </div>
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
        )}"""),
# Sidebar: the bell
("""  rail,
  shortcuts,
}: {
  route: Route;""",
"""  rail,
  shortcuts,
  bell,
}: {
  bell?: ReactNode;
  route: Route;"""),
("""          <CalendarDays size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="side__text">Calendar</span>
        </a>
      </div>""",
"""          <CalendarDays size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="side__text">Calendar</span>
        </a>
        {bell && <div className="side__bell">{bell}</div>}
      </div>"""),
])

# A calendar feed for the Calendar page.
apply(P, [
("""/** The time now, to the second. */""",
"""/** Your own calendar feed: every plan you are on, in Google Calendar, Outlook or Apple Calendar. */
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
            In your calendar app choose “Add calendar → From URL” (Google) or “Subscribe” (Apple, Outlook), and paste it. Keep it private: anyone with it sees your
            plans’ names and times.{' '}
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

/** The time now, to the second. */"""),
])
