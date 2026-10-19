import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

P = 'planner/src/PlanList.tsx'
apply(P, [
("""import { ChevronRight, LoaderCircle, Plus } from 'lucide-react';""",
"""import { ChevronRight, LayoutTemplate, LoaderCircle, Plus } from 'lucide-react';
import type { TemplateSummary } from './apiPro';"""),
("""  onCreate,
  phone = false,
  top,
}: {""",
"""  onCreate,
  onNewFrom,
  templates = [],
  phone = false,
  top,
}: {
  /** Open the new-plan window (templates), with the name typed so far. */
  onNewFrom?: (name: string) => void;
  /** Your templates (listed apart from the plans). */
  templates?: TemplateSummary[];"""),
("""          <button type="submit" className="btn btn--primary" disabled={busy}>
            <Plus size={15} strokeWidth={2} aria-hidden="true" />
            New plan
          </button>
        </form>
      )}""",
"""          <button type="submit" className="btn btn--primary" disabled={busy}>
            <Plus size={15} strokeWidth={2} aria-hidden="true" />
            New plan
          </button>
          {onNewFrom && (
            <button type="button" className="btn" onClick={() => onNewFrom(name)} title="Start from a template: conference, show, concert, gala…">
              <LayoutTemplate size={15} strokeWidth={1.75} aria-hidden="true" />
              {phone ? 'Templates' : 'From a template…'}
            </button>
          )}
        </form>
      )}"""),
("""      {past.length > 0 && (
        <>
          <h2 className="page__sub">Past events</h2>
          {table(past)}
        </>
      )}""",
"""      {past.length > 0 && (
        <>
          <h2 className="page__sub">Past events</h2>
          {table(past)}
        </>
      )}
      {templates.length > 0 && (
        <>
          <h2 className="page__sub">Your templates</h2>
          <ul className="templist">
            {templates.map((t) => (
              <li key={t.id}>
                <a href={`#/plan/${t.id}`}>
                  <LayoutTemplate size={15} strokeWidth={1.75} aria-hidden="true" />
                  <b>{t.name}</b>
                  {t.venue && <span className="muted"> · {t.venue}</span>}
                </a>
                {canPlan && onNewFrom && (
                  <button type="button" className="link small" onClick={() => onNewFrom('')}>
                    New plan from it…
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}"""),
])
