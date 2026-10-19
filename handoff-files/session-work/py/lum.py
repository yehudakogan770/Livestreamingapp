import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

apply('app/src/planner/fromPlanner.ts', [
("""/** Put the converted cues in: instead of the current ones, or after them (at most MAX_CUES in all). */""",
"""/**
 * The plan's scripts as one prompter script, in cue order: each cue's name in
 * capitals, then what is said. Floated cues and cues with no script are left out.
 */
export function planScript(planned: readonly PlanCue[]): string {
  return sortCues(planned)
    .filter((c) => !c.skip && c.script.trim())
    .map((c) => `${(c.title.trim() || segmentName(c.segment)).toUpperCase()}\\n\\n${c.script.trim()}`)
    .join('\\n\\n\\n')
    .slice(0, 100_000);
}

/** Put the converted cues in: instead of the current ones, or after them (at most MAX_CUES in all). */"""),
])

apply('app/src/planner/PlannerDialog.tsx', [
("""import { combine, DEFAULT_OPTIONS, MAX_CUES, planToCues, type ConvertOptions } from './fromPlanner';""",
"""import { combine, DEFAULT_OPTIONS, MAX_CUES, planScript, planToCues, type ConvertOptions } from './fromPlanner';
import { readLink, writeLink } from './plannerLink';"""),
("""export function PlannerDialog({ show, current, onLoad, onClose }: { show: Show; current: Cue[]; onLoad: (cues: Cue[]) => void; onClose: () => void }) {""",
"""export function PlannerDialog({
  show,
  current,
  onLoad,
  onClose,
  onScript,
}: {
  show: Show;
  current: Cue[];
  onLoad: (cues: Cue[]) => void;
  onClose: () => void;
  /** Put the plan's scripts on Lumora's prompter. */
  onScript?: (script: string) => void;
}) {"""),
("""  const [opts, setOpts] = useState<ConvertOptions>(DEFAULT_OPTIONS);""",
"""  const [opts, setOpts] = useState<ConvertOptions>(DEFAULT_OPTIONS);
  const [toPrompter, setToPrompter] = useState(true);
  const [follow, setFollow] = useState(true);"""),
("""  const load = (mode: 'replace' | 'append') => {
    if (!converted) return;
    onLoad(combine(current, converted.cues, mode));
    onClose();
  };""",
"""  const script = useMemo(() => (plan ? planScript(plan.cues) : ''), [plan]);
  // The plan has the Planner's show-day tools (scripts, the show followed live).
  const pro = plan?.plan.pro === true;
  const load = (mode: 'replace' | 'append') => {
    if (!converted || !plan) return;
    onLoad(combine(current, converted.cues, mode));
    if (pro && script && toPrompter && onScript) onScript(script);
    if (pro && follow) writeLink({ planId: plan.plan.id, planName: plan.plan.name });
    else if (readLink()?.planId === plan.plan.id) writeLink(null);
    onClose();
  };"""),
("""                  <label className="check">
                    <input type="checkbox" checked={opts.notesToMonitor} onChange={(e) => setOpts({ ...opts, notesToMonitor: e.target.checked })} /> Show each
                    cue’s notes on the Monitor when it runs
                  </label>""",
"""                  <label className="check">
                    <input type="checkbox" checked={opts.notesToMonitor} onChange={(e) => setOpts({ ...opts, notesToMonitor: e.target.checked })} /> Show each
                    cue’s notes on the Monitor when it runs
                  </label>
                  {pro && script && onScript && (
                    <label className="check">
                      <input type="checkbox" checked={toPrompter} onChange={(e) => setToPrompter(e.target.checked)} /> Put the cues’ scripts on the prompter (they
                      replace its script)
                    </label>
                  )}
                  {pro && (
                    <label className="check">
                      <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Show the cue on now in the Planner as these cues
                      run (the crew’s phones, stage timer and prompter follow)
                    </label>
                  )}"""),
])

apply('app/src/views/RunOfShow.tsx', [
("""import { PlannerDialog, openPlanner } from '../planner/PlannerDialog';""",
"""import { PlannerDialog, openPlanner } from '../planner/PlannerDialog';
import { usePlannerLink } from '../planner/plannerLink';
import { supabase } from '../auth/auth';
import { authOn } from '../auth/config';"""),
("""  const now = useNow(false, 500);
  const r = show.run;
  if (r.cues.length === 0) return null;
  const cur = r.current !== null ? r.cues[r.current] : null;""",
"""  const now = useNow(false, 500);
  const r = show.run;
  // Cues loaded from Lumora Planner: the plan follows the show (see plannerLink.ts).
  usePlannerLink(r.running, r.current !== null ? (r.cues[r.current]?.id ?? null) : null, linkDb);
  if (r.cues.length === 0) return null;
  const cur = r.current !== null ? r.cues[r.current] : null;"""),
("""/** The strip on the bottom bar: the cue running, the next one, and NEXT CUE. */""",
"""const linkDb = () => (authOn() ? supabase() : null);

/** The strip on the bottom bar: the cue running, the next one, and NEXT CUE. */"""),
("""          onClose={() => setPlanning(false)}
        />""",
"""          onClose={() => setPlanning(false)}
          onScript={(script) => act({ type: 'updatePrompter', on: show.monitor.prompter.on, script, size: show.monitor.prompter.size, mirror: show.monitor.prompter.mirror })}
        />"""),
])
