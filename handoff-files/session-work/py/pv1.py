import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

P = 'planner/src/PlanView.tsx'
apply(P, [
# imports
("""import { Check, ChevronRight, CircleAlert, Ellipsis, LoaderCircle, MessageSquare, PanelRight, Plus, Printer, StickyNote, UserPlus, X } from 'lucide-react';
import { deletePlan, removePerson } from './api';""",
"""import { Check, ChevronRight, CircleAlert, Ellipsis, LoaderCircle, MessageSquare, PanelRight, Plus, Printer, Radio, StickyNote, UserPlus, X } from 'lucide-react';
import { deletePlan, removePerson } from './api';
import * as pro from './apiPro';
import { cuesToRows, downloadBytes, downloadText, planToIcs, toCsv, toXlsx } from './csv';
import { ImportDialog, PlanSettings, ShortcutsDialog, VersionsDialog } from './Dialogs';
import { FilePanel, useFiles } from './Files';
import { KIND_WORDS, listOf, type ItemKind } from './items';
import { ListView } from './ListView';
import { Prompter } from './Prompter';
import { NowNextStrip, ShowView, StageTimer } from './ShowView';
import { PRINT_LAYOUTS, type PrintLayout } from './PrintSheet';
import { useItems } from './useItems';
import { useLive } from './useLive';
import { usePeople } from './usePeople';"""),
("""import { SEGMENTS, cueAt, cueLabel, eventSeconds, formatDuration, clock12, longDate, schedule, type PlanCue, type Schedule, type Segment } from './model';""",
"""import {
  SEGMENTS,
  cueAt,
  cueLabel,
  eventSeconds,
  formatDuration,
  clock12,
  longDate,
  parseClock,
  schedule,
  zoneAbbr,
  validZone,
  type CustomColumn,
  type PlanCue,
  type Schedule,
  type Segment,
} from './model';"""),
("""export type PlanTab = 'run' | 'schedule' | 'chat';""",
"""export type PlanTab = 'run' | 'schedule' | 'chat' | 'show' | 'timer' | 'prompter' | 'crew' | 'contacts' | 'tasks' | 'gear' | 'budget' | 'files';

/** The plan's list tabs, and the list each one shows. */
export const LIST_TABS: { tab: PlanTab; kind: ItemKind }[] = [
  { tab: 'crew', kind: 'crew' },
  { tab: 'tasks', kind: 'task' },
  { tab: 'gear', kind: 'gear' },
  { tab: 'budget', kind: 'budget' },
  { tab: 'contacts', kind: 'contact' },
];
const listKind = (t: PlanTab): ItemKind | null => LIST_TABS.find((x) => x.tab === t)?.kind ?? null;"""),
# state
("""  const [showNotes, setShowNotes] = useState(false);
  const [more, setMore] = useState(false);""",
"""  const [showNotes, setShowNotes] = useState(false);
  const [more, setMore] = useState(false);
  const [dialog, setDialog] = useState<null | 'versions' | 'import' | 'settings' | 'keys' | 'print'>(null);
  const [printLayout, setPrintLayout] = useState<PrintLayout>('run');
  const live = useLive(planId);
  const items = useItems(planId);
  const files = useFiles(planId);
  const people = usePeople(planId);
  const [locks, setLocks] = useState<pro.SectionLock[]>([]);
  useEffect(() => {
    let on = true;
    const load = () => void pro.loadLocks(db(), planId).then((l) => on && setLocks(l));
    load();
    const stop = pro.watchLocks(db(), planId, load);
    return () => {
      on = false;
      stop();
    };
  }, [planId]);"""),
("""    canEdit: store.role === 'owner' || store.role === 'editor',
    on: layout.device === 'computer' && tab === 'run' && !sharing && !!store.plan,""",
"""    canEdit: store.role === 'owner' || store.role === 'editor',
    on: layout.device === 'computer' && tab === 'run' && !sharing && !dialog && !!store.plan,"""),
("""      if (typing) return;
      if ((e.key === 'n' || e.key === 'N') && k.canEdit) {""",
"""      if (typing) return;
      if (e.key === '?') {
        e.preventDefault();
        setDialog('keys');
        return;
      }
      const selCue = i >= 0 ? k.cues[i]! : null;
      if ((e.key === 'd' || e.key === 'D') && k.canEdit && selCue) {
        e.preventDefault();
        const id = store.duplicateCue(selCue.id);
        if (id) setSel(id);
        return;
      }
      if ((e.key === 'f' || e.key === 'F') && k.canEdit && selCue && store.plan?.pro) {
        e.preventDefault();
        store.editCue(selCue.id, { skip: !selCue.skip });
        return;
      }
      if ((e.key === 'n' || e.key === 'N') && k.canEdit) {"""),
("""  const sched = useMemo(() => schedule(cues, plan?.startTime ?? ''), [cues, plan?.startTime]);
  const nowSec = plan ? eventSeconds(plan.eventDate, now) : null;""",
"""  const sched = useMemo(() => schedule(cues, plan?.startTime ?? ''), [cues, plan?.startTime]);
  const nowSec = plan ? eventSeconds(plan.eventDate, now, plan.timeZone) : null;"""),
])

# Full-page show views and the rest come right after `if (!plan) return ...`
apply(P, [
("""  const leaveOrDelete = () => {
    if (role === 'owner') {""",
"""  const isPro = plan.pro;
  const showData = { plan, cues, live: live.live, log: live.log, offset: live.offset };
  const toRun = () => onTab('run');
  if (isPro && tab === 'show')
    return (
      <>
        <ShowView
          data={showData}
          store={canEdit ? live : undefined}
          onBack={toRun}
          onTimer={() => onTab('timer')}
          onPrompter={() => onTab('prompter')}
          onUseLengths={(m) => store.editCues(new Map([...m].map(([id, s]) => [id, { durationSec: s }])))}
          compact={phone}
        />
      </>
    );
  if (isPro && tab === 'timer') return <StageTimer data={showData} onClose={() => onTab('show')} />;
  if (isPro && tab === 'prompter') return <Prompter cues={cues} live={live.live} title={plan.name || 'Untitled plan'} onClose={() => onTab('show')} />;

  const editable = (c: PlanCue) => canEdit && pro.canEditSection(role, me.id, c.section, locks);
  const addColumns = (cols: CustomColumn[]): CustomColumn[] => {
    const next = [...plan.columns, ...cols].slice(0, 12);
    store.editPlan({ columns: next });
    return next;
  };
  const exportSheet = (kind: 'csv' | 'xlsx') => {
    const rows = cuesToRows(cues, plan.startTime, plan.columns);
    const base = plan.name || 'Run of show';
    if (kind === 'csv') downloadText(`${base}.csv`, toCsv(rows), 'text/csv');
    else {
      const sheets = [{ name: 'Run of show', rows }];
      const kinds: ItemKind[] = ['crew', 'task', 'gear', 'contact', ...(canEdit ? (['budget'] as ItemKind[]) : [])];
      for (const k of kinds) {
        const l = listOf(items.items, k);
        if (!l.length) continue;
        const w = KIND_WORDS[k];
        sheets.push({
          name: w.name,
          rows: [
            [w.title, ...(w.role ? [w.role] : []), ...(w.person ? [w.person] : []), 'Phone', 'Email', 'Call time', 'Day', 'Qty', 'Amount', 'Actual', 'Status', 'Done', 'Notes'],
            ...l.map((it) => [
              it.title,
              ...(w.role ? [it.role] : []),
              ...(w.person ? [it.person] : []),
              it.phone,
              it.email,
              it.callTime ? clock12(parseClock(it.callTime) ?? 0) : '',
              it.day,
              it.qty === null ? '' : String(it.qty),
              it.amount === null ? '' : it.amount.toFixed(2),
              it.actual === null ? '' : it.actual.toFixed(2),
              it.status,
              it.done ? 'yes' : '',
              it.notes,
            ]),
          ],
        });
      }
      downloadBytes(`${base}.xlsx`, toXlsx(sheets), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
  };
  const printAs = (l: PrintLayout) => {
    setPrintLayout(l);
    setDialog(null);
    setTimeout(() => window.print(), 50);
  };

  const leaveOrDelete = () => {
    if (role === 'owner') {"""),
("""      deletePlan(db(), plan.id)
        .then(onBack)""",
"""      // Its stored files first (the plan's rows go with the plan; stored files do not).
      Promise.all(files.files.map((f) => pro.deleteFile(db(), f).catch(() => {})))
        .then(() => deletePlan(db(), plan.id))
        .then(onBack)"""),
])

# Print sheet + share dialog + dialogs
apply(P, [
("""      <PrintSheet plan={plan} cues={cues} sched={sched} blocks={blocks.blocks} />
      {sharing && <ShareDialog plan={plan} role={role} me={me.id} onClose={() => setSharing(false)} onChanged={store.reloadRole} />}""",
"""      <PrintSheet plan={plan} cues={cues} sched={sched} blocks={blocks.blocks} items={items.items} layout={printLayout} />
      {sharing && (
        <ShareDialog
          plan={plan}
          role={role}
          me={me.id}
          onClose={() => setSharing(false)}
          onChanged={store.reloadRole}
          cues={cues}
          onShareChanged={(token, scope) => store.patchPlan({ shareToken: token, shareScope: scope })}
        />
      )}
      {dialog === 'versions' && <VersionsDialog plan={plan} cues={cues} canEdit={canEdit} isOwner={role === 'owner'} onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ImportDialog plan={plan} onAdd={(list) => store.addCues(list)} onAddColumns={addColumns} onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <PlanSettings plan={plan} canEdit={canEdit} onChange={(c) => store.editPlan(c)} onClose={() => setDialog(null)} />}
      {dialog === 'keys' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'print' && (
        <PrintChooser onPick={printAs} onClose={() => setDialog(null)} canBudget={canEdit} />
      )}"""),
])
