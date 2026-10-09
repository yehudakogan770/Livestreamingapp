import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  Check,
  ChevronRight,
  CircleAlert,
  Ellipsis,
  LoaderCircle,
  MessageSquare,
  PanelRight,
  Plus,
  Printer,
  Radio,
  StickyNote,
  UserPlus,
  X,
  Columns3,
} from 'lucide-react';
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
import { usePeople } from './usePeople';
import './pro.css';
import { Chat } from './Chat';
import { ClockInput, DurationInput } from './fields';
import { Inspector, hintText, initials } from './Inspector';
import { Mark } from './Mark';
import {
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
} from './model';
import { PhonePlan } from './PhonePlan';
import { PrintSheet } from './PrintSheet';
import { BlockEditor, ScheduleView } from './Schedule';
import { db } from './session';
import { ShareDialog } from './ShareDialog';
import { useLayout } from './device';
import { useBackToClose, useReorder } from './touch';
import { useBlocks } from './useBlocks';
import { useChat } from './useChat';
import { usePlan, type PlanStore } from './usePlan';

export { hintText };

export type PlanTab = 'run' | 'schedule' | 'chat' | 'show' | 'timer' | 'prompter' | 'crew' | 'contacts' | 'tasks' | 'gear' | 'budget' | 'files';

/** The plan's list tabs, and the list each one shows. */
export const LIST_TABS: { tab: PlanTab; kind: ItemKind }[] = [
  { tab: 'crew', kind: 'crew' },
  { tab: 'tasks', kind: 'task' },
  { tab: 'gear', kind: 'gear' },
  { tab: 'budget', kind: 'budget' },
  { tab: 'contacts', kind: 'contact' },
];
const listKind = (t: PlanTab): ItemKind | null => LIST_TABS.find((x) => x.tab === t)?.kind ?? null;

const ROLE_WORDS = { owner: 'You own this plan', editor: 'You can edit', viewer: 'View only' } as const;

function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Focus a field and bring it into view. */
function focusField(sel: string) {
  const el = document.querySelector<HTMLElement>(sel);
  el?.scrollIntoView?.({ block: 'center' });
  el?.focus();
}

/** One plan: its details, the run of show (cue sheet) or the schedule, the cue or block being edited, the chat, and the totals. */
export function PlanView({
  planId,
  me,
  onBack,
  tab = 'run',
  onTab = () => {},
  onUnread = () => {},
}: {
  planId: string;
  me: { id: string; name: string };
  onBack: () => void;
  tab?: PlanTab;
  onTab?: (t: PlanTab) => void;
  onUnread?: (n: number) => void;
}) {
  const store = usePlan(planId, me);
  const { plan, cues, comments, role, here, error, gone, saving } = store;
  const layout = useLayout();
  const phone = layout.device === 'phone';
  /** The side panel lies over the sheet and opens when asked: a narrow computer window, or a tablet held upright. */
  const overlay = layout.compact || (layout.device === 'tablet' && layout.orientation === 'portrait');
  const [panelOpen, setPanelOpen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [blockSel, setBlockSel] = useState<string | null>(null);
  const [panel, setPanel] = useState<'detail' | 'chat'>('detail');
  const [sharing, setSharing] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [more, setMore] = useState(false);
  const [dialog, setDialog] = useState<null | 'versions' | 'import' | 'settings' | 'keys' | 'print'>(null);
  const [printLayout, setPrintLayout] = useState<PrintLayout>('run');
  const [hidden, setHidden] = useHidden(planId);
  const live = useLive(planId);
  const items = useItems(planId);
  const files = useFiles(planId);
  const people = usePeople(planId);
  const mentionable = useMemo(() => people.map((p) => ({ userId: p.userId, name: p.name, email: p.email })), [people]);
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
  }, [planId]);
  const now = useNow();
  const canEdit = role === 'owner' || role === 'editor';
  const chatOpen = phone ? tab === 'chat' : panel === 'chat' && (!overlay || panelOpen);
  const chat = useChat(planId, me, chatOpen);
  const blocks = useBlocks(planId);
  useBackToClose(sharing, () => setSharing(false));
  useEffect(() => {
    if (!overlay) setPanelOpen(false);
  }, [overlay]);
  /** Show the cue (or block) details, or the chat, in the side panel. */
  const showPanel = (p: 'detail' | 'chat') => {
    setPanel(p);
    if (overlay) setPanelOpen(true);
  };

  // Computers: the keyboard. N adds a cue, ↑/↓ move the selection, Enter edits it, Esc closes the panel.
  const keyState = useRef({ sel, cues: store.cues, panel, panelOpen, overlay, canEdit: false, on: false });
  keyState.current = {
    sel,
    cues: store.cues,
    panel,
    panelOpen,
    overlay,
    canEdit: store.role === 'owner' || store.role === 'editor',
    on: layout.device === 'computer' && tab === 'run' && !sharing && !dialog && !!store.plan,
  };
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const k = keyState.current;
      if (!k.on || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const i = k.cues.findIndex((c) => c.id === k.sel);
      if (e.key === 'Escape') {
        if (typing && t!.closest('.cues')) t!.blur();
        else if (typing) return;
        else if (k.overlay && k.panelOpen) setPanelOpen(false);
        else if (k.panel === 'chat') setPanel('detail');
        else if (k.sel) setSel(null);
        else return;
        e.preventDefault();
        return;
      }
      if (typing) return;
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
      if ((e.key === 'n' || e.key === 'N') && k.canEdit) {
        e.preventDefault();
        const id = store.addCue(k.sel);
        if (id) {
          setSel(id);
          setPanel('detail');
          setTimeout(() => focusField(`#cue-${id} .cell--title`), 0);
        }
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && k.cues.length > 0) {
        e.preventDefault();
        const next = i < 0 ? (e.key === 'ArrowDown' ? 0 : k.cues.length - 1) : Math.max(0, Math.min(k.cues.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
        const id = k.cues[next]!.id;
        setSel(id);
        document.getElementById(`cue-${id}`)?.scrollIntoView?.({ block: 'nearest' });
      } else if (e.key === 'Enter' && i >= 0) {
        e.preventDefault();
        if (k.overlay) {
          setPanel('detail');
          setPanelOpen(true);
        } else focusField(`#cue-${k.cues[i]!.id} .cell--title`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  useEffect(() => onUnread(chat.unread), [chat.unread, onUnread]);
  // Larger screens show the chat beside the plan, not as a page of its own.
  useEffect(() => {
    if (!phone && tab === 'chat') {
      showPanel('chat');
      onTab('run');
    }
  }, [phone, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const sched = useMemo(() => schedule(cues, plan?.startTime ?? ''), [cues, plan?.startTime]);
  const nowSec = plan ? eventSeconds(plan.eventDate, now, plan.timeZone) : null;
  const onNow = nowSec === null ? null : cueAt(sched, nowSec);
  const commentCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of comments) m.set(c.cueId, (m.get(c.cueId) ?? 0) + 1);
    return m;
  }, [comments]);

  const selected = cues.find((c) => c.id === sel) ?? null;
  const block = blocks.blocks.find((b) => b.id === blockSel) ?? null;
  useEffect(() => {
    if (sel && !cues.some((c) => c.id === sel)) setSel(null);
  }, [cues, sel]);

  if (gone)
    return (
      <main className="page">
        <div className="empty empty--center">
          <Mark size={32} />
          <p>This plan was deleted, or it is no longer shared with you.</p>
          <button type="button" className="btn" onClick={onBack}>
            Back to plans
          </button>
        </div>
      </main>
    );
  if (!plan)
    return (
      <main className="page">
        <div className="empty empty--center empty--quiet">
          <Mark size={32} />
          {error ? <p className="warn">{error}</p> : <p className="muted">Opening the plan…</p>}
          <button type="button" className="btn" onClick={onBack}>
            Back to plans
          </button>
        </div>
      </main>
    );

  const isPro = plan.pro;
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
            [
              w.title,
              ...(w.role ? [w.role] : []),
              ...(w.person ? [w.person] : []),
              'Phone',
              'Email',
              'Call time',
              'Day',
              'Qty',
              'Amount',
              'Actual',
              'Status',
              'Done',
              'Notes',
            ],
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
    if (role === 'owner') {
      if (!confirm(`Delete “${plan.name}” for everyone? Its cues, schedule, chat and comments are deleted too. This can’t be undone.`)) return;
      // Its stored files first (the plan's rows go with the plan; stored files do not).
      Promise.all(files.files.map((f) => pro.deleteFile(db(), f).catch(() => {})))
        .then(() => deletePlan(db(), plan.id))
        .then(onBack)
        .catch((e: unknown) => alert(e instanceof Error ? e.message : String(e)));
    } else {
      if (!confirm(`Leave “${plan.name}”? You won’t see it any more unless the owner shares it again.`)) return;
      removePerson(db(), plan.id, me.id)
        .then(onBack)
        .catch((e: unknown) => alert(e instanceof Error ? e.message : String(e)));
    }
  };

  /** "#4" in the chat: show cue 4. */
  const showCue = (n: number) => {
    const c = cues[n - 1];
    if (!c) return;
    setSel(c.id);
    onTab('run');
    setTimeout(() => document.getElementById(`cue-${c.id}`)?.scrollIntoView?.({ block: 'center' }), 0);
  };
  const firstUntimed = () => {
    const i = cues.findIndex((c) => c.durationSec === null);
    if (i < 0) return;
    setSel(cues[i]!.id);
    if (phone) return;
    showPanel('detail');
    setTimeout(() => focusField(`[aria-label="Length of cue ${i + 1}"]`), 0);
  };

  const shared = (
    <>
      <PrintSheet plan={plan} cues={cues} sched={sched} blocks={blocks.blocks} items={items.items} layout={printLayout} />
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
      {dialog === 'print' && <PrintChooser onPick={printAs} onClose={() => setDialog(null)} canBudget={canEdit} />}
    </>
  );

  if (phone)
    return (
      <>
        <PhonePlan
          store={store}
          sched={sched}
          sel={sel}
          onSel={setSel}
          canEdit={canEdit}
          onNow={onNow}
          nowSec={nowSec}
          commentCount={commentCount}
          me={me}
          onBack={onBack}
          onShare={() => setSharing(true)}
          onLeaveOrDelete={leaveOrDelete}
          tab={tab}
          onTab={onTab}
          chat={chat}
          blocks={blocks}
          blockSel={blockSel}
          onBlockSel={setBlockSel}
          onCue={showCue}
          onFirstUntimed={firstUntimed}
          extra={
            isPro
              ? {
                  onShow: () => onTab('show'),
                  onAir: live.live?.state === 'running' || live.live?.state === 'paused',
                  strip: <NowNextStrip data={showData} />,
                  bodyName: listKind(tab) ? KIND_WORDS[listKind(tab)!].name : tab === 'files' ? 'Files' : '',
                  body: listKind(tab) ? (
                    <ListView
                      kind={listKind(tab)!}
                      store={items}
                      canEdit={canEdit}
                      me={me.id}
                      cues={cues}
                      people={people}
                      planName={plan.name}
                      onCue={(id) => {
                        setSel(id);
                        onTab('run');
                      }}
                    />
                  ) : tab === 'files' ? (
                    <FilePanel store={files} cues={cues} canEdit={canEdit} />
                  ) : null,
                  menu: [
                    { label: canEdit ? 'Run the show' : 'Follow the show', run: () => onTab('show') },
                    { label: 'Stage timer', run: () => onTab('timer') },
                    { label: 'Prompter', run: () => onTab('prompter') },
                    ...LIST_TABS.filter((t) => t.kind !== 'budget' || canEdit).map((t) => ({ label: KIND_WORDS[t.kind].name, run: () => onTab(t.tab) })),
                    { label: 'Files', run: () => onTab('files') },
                    { label: 'Print or save as PDF…', run: () => setDialog('print') },
                    { label: 'Versions…', run: () => setDialog('versions') },
                    { label: 'Plan settings…', run: () => setDialog('settings') },
                    ...(canEdit ? [{ label: 'Import cues from a sheet…', run: () => setDialog('import') }] : []),
                    { label: 'Download for Excel', run: () => exportSheet('xlsx') },
                    {
                      label: 'Add to a calendar',
                      run: () => downloadText(`${plan.name || 'Plan'}.ics`, planToIcs(plan, cues, blocks.blocks), 'text/calendar'),
                    },
                  ],
                  inspector: { pro: true, columns: plan.columns, items, files, people },
                  people: mentionable,
                  editable,
                }
              : undefined
          }
        />
        {shared}
      </>
    );

  const detailName = tab === 'schedule' ? 'Block' : 'Cue';
  let detail: ReactNode;
  if (tab === 'schedule')
    detail = block ? (
      <>
        <div className="inspector__head inspector__head--solo">
          <div className="inspector__id">
            <b>{block.title || 'Untitled block'}</b>
            <span className="muted small">Schedule block</span>
          </div>
        </div>
        <BlockEditor key={block.id} block={block} store={blocks} canEdit={canEdit} onClose={() => setBlockSel(null)} />
      </>
    ) : (
      <div className="inspector__empty">
        <p>Select a block to see and edit it.</p>
        <p className="muted small">
          A block is a stretch of the day for the people: crew call, load-in, sound check, doors, strike. Give it a time, a place and who it is for; “My
          schedule” shows yours.
        </p>
        {canEdit && layout.device === 'computer' && <p className="muted small">Double-click an empty time on the timeline to add a block there.</p>}
      </div>
    );
  else
    detail = selected ? (
      <Inspector
        key={selected.id}
        cue={selected}
        index={cues.indexOf(selected)}
        count={cues.length}
        store={store}
        canEdit={editable(selected)}
        comments={comments.filter((c) => c.cueId === selected.id)}
        me={me.id}
        isOwner={role === 'owner'}
        timed={sched.rows[cues.indexOf(selected)]}
        onSel={setSel}
        pro={isPro}
        columns={plan.columns}
        locked={canEdit && !editable(selected)}
        items={items}
        files={files}
        people={people}
      />
    ) : (
      <div className="inspector__empty">
        <p>Select a cue to see and edit its details, Lumora hints and comments.</p>
        <p className="muted small">
          Times: a cue starts when the one before ends, unless it has a fixed start. Lengths are in minutes: 5, 4:30, 90s or 1h 30m. Drag the handle to reorder.
        </p>
        <p className="muted small">In Lumora: Run of show → Load from Planner… loads these cues.</p>
        <button type="button" className="btn btn--quiet btn--danger" onClick={leaveOrDelete}>
          {role === 'owner' ? 'Delete plan…' : 'Leave plan…'}
        </button>
      </div>
    );

  return (
    <>
      <main className="plan no-print">
        <header className="plan__bar">
          <nav className="plan__crumbs" aria-label="Breadcrumb">
            <a href="#/" onClick={onBack}>
              Plans
            </a>
            <span aria-hidden="true">/</span>
          </nav>
          <input
            className="plan__name"
            value={plan.name}
            maxLength={120}
            readOnly={!canEdit}
            onChange={(e) => store.editPlan({ name: e.target.value })}
            aria-label="Event name"
            placeholder="Event name"
          />
          {here.length > 0 && (
            <span className="tools__here" title={`Also here: ${here.join(', ')}`}>
              {here.map((n) => (
                <span key={n} className="who-chip" title={n}>
                  {initials(n)}
                </span>
              ))}
              <span className="muted">{here.length === 1 ? `${here[0]} is here` : `${here.length} others here`}</span>
            </span>
          )}
          <span className={`tools__save tools__save--${saving}`} role="status">
            {saving === 'saved' ? (
              <Check size={14} strokeWidth={2} aria-hidden="true" />
            ) : saving === 'saving' ? (
              <LoaderCircle size={14} strokeWidth={2} aria-hidden="true" className="spin" />
            ) : (
              <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
            )}
            {saving === 'saved' ? 'All changes saved' : saving === 'saving' ? 'Saving…' : 'Not saved — retrying'}
          </span>
          {isPro && (
            <button
              type="button"
              className={`btn${live.live?.state === 'running' || live.live?.state === 'paused' ? ' btn--onair' : ''}`}
              onClick={() => onTab('show')}
              title={canEdit ? 'Call the show: GO for each cue, with timers for everyone' : 'Follow the show: what is on now and next'}
            >
              <Radio size={15} strokeWidth={1.75} aria-hidden="true" />
              {live.live?.state === 'running' || live.live?.state === 'paused' ? 'Live now' : canEdit ? 'Run the show' : 'Follow the show'}
            </button>
          )}
          <button type="button" className="btn" onClick={() => setSharing(true)}>
            <UserPlus size={15} strokeWidth={1.75} aria-hidden="true" />
            Share…
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => (isPro ? setDialog('print') : window.print())}
            title="Print, or save as PDF"
            aria-label="Print / PDF"
          >
            <Printer size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <div className="account">
            <button
              type="button"
              className="btn btn--icon btn--quiet"
              aria-label="More"
              aria-haspopup="menu"
              aria-expanded={more}
              onClick={() => setMore(!more)}
            >
              <Ellipsis size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {more && (
              <div className="popover popover--menu" role="menu" aria-label="More" onMouseLeave={() => setMore(false)}>
                <button
                  type="button"
                  role="menuitem"
                  className="popover__item"
                  onClick={() => {
                    setMore(false);
                    if (isPro) setDialog('print');
                    else window.print();
                  }}
                >
                  Print or save as PDF…
                </button>
                {isPro && (
                  <>
                    <MenuItem onClick={() => (setMore(false), setDialog('settings'))}>Plan settings (time zone, columns)…</MenuItem>
                    <MenuItem onClick={() => (setMore(false), setDialog('versions'))}>Versions…</MenuItem>
                    {canEdit && <MenuItem onClick={() => (setMore(false), setDialog('import'))}>Import cues from a sheet…</MenuItem>}
                    <div className="popover__sep" role="separator" />
                    <MenuItem onClick={() => (setMore(false), exportSheet('xlsx'))}>Download for Excel (.xlsx)</MenuItem>
                    <MenuItem onClick={() => (setMore(false), exportSheet('csv'))}>Download as CSV</MenuItem>
                    <MenuItem
                      onClick={() => {
                        setMore(false);
                        downloadText(`${plan.name || 'Plan'}.ics`, planToIcs(plan, cues, blocks.blocks), 'text/calendar');
                      }}
                    >
                      Add to a calendar (.ics)
                    </MenuItem>
                    <div className="popover__sep" role="separator" />
                    <MenuItem
                      onClick={() => {
                        setMore(false);
                        const name = prompt('Name of the copy:', `${plan.name || 'Untitled plan'} (copy)`);
                        if (name === null) return;
                        pro
                          .copyPlan(db(), plan.id, name, false)
                          .then((id) => (location.hash = `#/plan/${id}`))
                          .catch((e: unknown) => alert(e instanceof Error ? e.message : String(e)));
                      }}
                    >
                      Duplicate plan…
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        setMore(false);
                        const name = prompt('Name of the template:', `${plan.name || 'Untitled plan'} template`);
                        if (name === null) return;
                        pro
                          .copyPlan(db(), plan.id, name, true)
                          .then(() => alert('Saved. New plans can start from it (New plan → From a template).'))
                          .catch((e: unknown) => alert(e instanceof Error ? e.message : String(e)));
                      }}
                    >
                      Save as a template…
                    </MenuItem>
                    {layout.device === 'computer' && <MenuItem onClick={() => (setMore(false), setDialog('keys'))}>Keyboard shortcuts</MenuItem>}
                    <div className="popover__sep" role="separator" />
                  </>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="popover__item popover__item--danger"
                  onClick={() => {
                    setMore(false);
                    leaveOrDelete();
                  }}
                >
                  {role === 'owner' ? 'Delete plan…' : 'Leave plan…'}
                </button>
              </div>
            )}
          </div>
        </header>
        <section className="plan__meta" aria-label="Event">
          <label className="mini">
            <span>Date</span>
            <input
              type="date"
              className="input"
              value={plan.eventDate}
              readOnly={!canEdit}
              onChange={(e) => canEdit && store.editPlan({ eventDate: e.target.value })}
            />
          </label>
          <label className="mini">
            <span>Show starts</span>
            <span className="mini__in" id="plan-start-wrap">
              <ClockInput
                value={plan.startTime}
                readOnly={!canEdit}
                placeholder="7:30 PM"
                label="Show starts"
                onChange={(v) => store.editPlan({ startTime: v })}
                className="input input--time"
              />
              {plan.timeZone && validZone(plan.timeZone) && (
                <button type="button" className="mini__zone" title={`Times are ${plan.timeZone.replace(/_/g, ' ')}`} onClick={() => setDialog('settings')}>
                  {zoneAbbr(plan.timeZone)}
                </button>
              )}
            </span>
          </label>
          <label className="mini mini--wide">
            <span>Venue</span>
            <input
              className="input"
              value={plan.venue}
              maxLength={120}
              readOnly={!canEdit}
              placeholder="Where"
              onChange={(e) => store.editPlan({ venue: e.target.value })}
            />
          </label>
          <button type="button" className={`btn btn--quiet${showNotes ? ' is-on' : ''}`} aria-expanded={showNotes} onClick={() => setShowNotes(!showNotes)}>
            <StickyNote size={15} strokeWidth={1.75} aria-hidden="true" />
            {showNotes ? 'Hide event notes' : plan.notes ? 'Event notes (1)' : 'Event notes'}
          </button>
          <span className="bar__spacer" />
          <span className="tools__note">{ROLE_WORDS[role ?? 'viewer']}</span>
          {showNotes && (
            <textarea
              className="input plan__notes"
              rows={4}
              maxLength={8000}
              value={plan.notes}
              readOnly={!canEdit}
              placeholder="Contacts, parking, stream details…"
              onChange={(e) => store.editPlan({ notes: e.target.value })}
              aria-label="Event notes"
            />
          )}
        </section>

        <div className="plan__tabs">
          <div className="tabs" role="tablist" aria-label="Plan">
            <button type="button" role="tab" className="tabs__tab" aria-selected={tab === 'run' || tab === 'chat'} onClick={() => onTab('run')}>
              Run of show
              <span className="tabs__n">{cues.length}</span>
            </button>
            <button type="button" role="tab" className="tabs__tab" aria-selected={tab === 'schedule'} onClick={() => onTab('schedule')}>
              Schedule
              {blocks.blocks.length > 0 && <span className="tabs__n">{blocks.blocks.length}</span>}
            </button>
            {isPro &&
              LIST_TABS.filter((t) => t.kind !== 'budget' || canEdit).map((t) => {
                const n = listOf(items.items, t.kind);
                const open = t.kind === 'task' ? n.filter((x) => !x.done).length : n.length;
                return (
                  <button key={t.tab} type="button" role="tab" className="tabs__tab" aria-selected={tab === t.tab} onClick={() => onTab(t.tab)}>
                    {KIND_WORDS[t.kind].name}
                    {open > 0 && <span className="tabs__n">{open}</span>}
                  </button>
                );
              })}
            {isPro && (
              <button type="button" role="tab" className="tabs__tab" aria-selected={tab === 'files'} onClick={() => onTab('files')}>
                Files
                {files.files.length > 0 && <span className="tabs__n">{files.files.length}</span>}
              </button>
            )}
          </div>
          <span className="bar__spacer" />
          {overlay && (
            <>
              <button
                type="button"
                className={`btn btn--quiet${panelOpen && panel === 'detail' ? ' is-on' : ''}`}
                aria-pressed={panelOpen && panel === 'detail'}
                onClick={() => (panelOpen && panel === 'detail' ? setPanelOpen(false) : showPanel('detail'))}
              >
                <PanelRight size={15} strokeWidth={1.75} aria-hidden="true" />
                {detailName}
              </button>
              <button
                type="button"
                className={`btn btn--quiet${panelOpen && panel === 'chat' ? ' is-on' : ''}`}
                aria-pressed={panelOpen && panel === 'chat'}
                onClick={() => (panelOpen && panel === 'chat' ? setPanelOpen(false) : showPanel('chat'))}
              >
                <MessageSquare size={15} strokeWidth={1.75} aria-hidden="true" />
                Chat
                {chat.unread > 0 && (
                  <span className="panel__n" aria-label={`${chat.unread} unread`}>
                    {chat.unread}
                  </span>
                )}
              </button>
            </>
          )}
          {(tab === 'run' || tab === 'chat') && <ColumnsMenu hidden={hidden} onChange={setHidden} columns={plan.columns} />}
          {(tab === 'run' || tab === 'chat') && canEdit && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                const id = store.addCue(sel);
                if (id) {
                  setSel(id);
                  setPanel('detail');
                  if (overlay) setTimeout(() => focusField(`#cue-${id} .cell--title`), 0);
                }
              }}
            >
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
              Add cue{sel ? ' below' : ''}
            </button>
          )}
        </div>
        {error && <p className="warn plan__error">{error}</p>}
        {isPro && <NowNextStrip data={showData} />}

        <div className="plan__body">
          {listKind(tab) ? (
            <ListView
              kind={listKind(tab)!}
              store={items}
              canEdit={canEdit}
              me={me.id}
              cues={cues}
              people={people}
              planName={plan.name}
              onCue={(id) => {
                setSel(id);
                onTab('run');
              }}
            />
          ) : tab === 'files' ? (
            <div className="files-page">
              <FilePanel store={files} cues={cues} canEdit={canEdit} />
            </div>
          ) : tab === 'schedule' ? (
            <ScheduleView
              store={blocks}
              plan={plan}
              canEdit={canEdit}
              me={me}
              sel={blockSel}
              onSel={(id) => (setBlockSel(id), id ? showPanel('detail') : setPanel('detail'))}
            />
          ) : (
            <CueSheet
              store={store}
              sched={sched}
              sel={sel}
              onSel={(id) => {
                setSel(id);
                if (id && panel === 'chat' && sel === id) setPanel('detail');
              }}
              canEdit={canEdit}
              editable={editable}
              columns={plan.columns}
              hidden={hidden}
              onNow={onNow}
              commentCount={commentCount}
              hasStart={!!plan.startTime}
              onOpen={
                overlay || layout.device === 'tablet'
                  ? (id) => {
                      setSel(id);
                      showPanel('detail');
                    }
                  : undefined
              }
            />
          )}
          {overlay && panelOpen && <div className="scrim panel__scrim" onClick={() => setPanelOpen(false)} aria-hidden="true" />}
          <aside
            className={`panel${overlay ? ' panel--over' : ''}${overlay && panelOpen ? ' is-open' : ''}`}
            aria-label="Details and chat"
            aria-hidden={overlay && !panelOpen ? true : undefined}
            inert={overlay && !panelOpen ? true : undefined}
          >
            <div className="panel__tabs" role="tablist" aria-label="Side panel">
              <button type="button" role="tab" className="panel__tab" aria-selected={panel === 'detail'} onClick={() => setPanel('detail')}>
                {detailName}
              </button>
              <button type="button" role="tab" className="panel__tab" aria-selected={panel === 'chat'} onClick={() => setPanel('chat')}>
                Chat
                {chat.unread > 0 && (
                  <span className="panel__n" aria-label={`${chat.unread} unread`}>
                    {chat.unread}
                  </span>
                )}
              </button>
              {overlay && (
                <button
                  type="button"
                  className="btn btn--quiet btn--icon panel__close"
                  onClick={() => setPanelOpen(false)}
                  aria-label="Close the panel"
                  title="Close (Esc)"
                >
                  <X size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className={`panel__body${panel === 'chat' ? ' panel__body--chat' : ''}`}>
              {panel === 'chat' ? (
                <Chat
                  chat={chat}
                  me={me.id}
                  isOwner={role === 'owner'}
                  cueCount={cues.length}
                  onCue={showCue}
                  planName={plan.name}
                  people={isPro ? mentionable : undefined}
                />
              ) : (
                <div className="inspector">{detail}</div>
              )}
            </div>
          </aside>
        </div>

        {(tab === 'run' || tab === 'chat') && (
          <footer className="status">
            <span>
              {cues.length} cue{cues.length === 1 ? '' : 's'}
            </span>
            <span>
              Total <b>{formatDuration(sched.totalSec) || '0:00'}</b>
            </span>
            {plan.startTime && sched.endSec !== null && (
              <span>
                Ends <b>{clock12(sched.endSec)}</b>
                {plan.timeZone && validZone(plan.timeZone) && ` ${zoneAbbr(plan.timeZone)}`}
              </span>
            )}
            {plan.endBy && sched.endSec !== null && parseClock(plan.endBy) !== null && <EndBy endSec={sched.endSec} endBy={parseClock(plan.endBy)!} />}
            {!plan.startTime && cues.length > 0 && (
              <button type="button" className="status__link" onClick={() => focusField('#plan-start-wrap input')}>
                Set a start time to see when each cue begins
              </button>
            )}
            {sched.untimed > 0 && (
              <button type="button" className="status__link warn-text" onClick={firstUntimed} title="Show the first cue without a length">
                {sched.untimed} without a length
              </button>
            )}
            <span className="status__div" aria-hidden="true" />
            <span className="status__segs">
              {SEGMENTS.filter((s) => sched.bySegment[s.id]).map((s) => (
                <span key={s.id} className="status__seg">
                  {s.name} {formatDuration(sched.bySegment[s.id]!)}
                </span>
              ))}
            </span>
            <span className="bar__spacer" />
            <RunningClock sched={sched} cues={cues} nowSec={nowSec} onNow={onNow} eventDate={plan.eventDate} now={now} />
          </footer>
        )}
      </main>
      {shared}
    </>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" className="popover__item" onClick={onClick}>
      {children}
    </button>
  );
}

/** How the planned end compares with the time the show must end by. */
function EndBy({ endSec, endBy }: { endSec: number; endBy: number }) {
  // The end-by time is on the event day, or just after midnight.
  const target = endBy < endSec - 12 * 3600 ? endBy + 86_400 : endBy;
  const d = endSec - target;
  if (Math.abs(d) < 30) return <span>On time for {clock12(endBy)}</span>;
  return (
    <span className={d > 0 ? 'warn-text' : 'muted'} title={`The show must end by ${clock12(endBy)}`}>
      <b>{formatDuration(Math.abs(d))}</b> {d > 0 ? 'over' : 'under'} the {clock12(endBy)} end
    </span>
  );
}

/** Choose what to print. */
function PrintChooser({ onPick, onClose, canBudget }: { onPick: (l: PrintLayout) => void; onClose: () => void; canBudget: boolean }) {
  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-label="Print" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog__box">
        <header className="dialog__head">
          <h2>Print or save as PDF</h2>
          <button type="button" className="btn btn--quiet btn--icon" onClick={onClose} aria-label="Close" title="Close">
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>
        <div className="dialog__body">
          <div className="choices">
            {PRINT_LAYOUTS.map((l) => (
              <button key={l.id} type="button" className="choice" onClick={() => onPick(l.id)}>
                <b>{l.name}</b>
                <span className="muted small">{l.id === 'lists' && !canBudget ? l.what.replace(/ \(and the budget.*\)/, '') : l.what}</span>
              </button>
            ))}
          </div>
          <p className="muted small">To save a PDF, choose “Save as PDF” as the printer.</p>
        </div>
      </div>
    </div>
  );
}

/** On the event day: what is on now and how long it has left; otherwise how far away the event is. */
function RunningClock({
  sched,
  cues,
  nowSec,
  onNow,
  eventDate,
  now,
}: {
  sched: Schedule;
  cues: PlanCue[];
  nowSec: number | null;
  onNow: number | null;
  eventDate: string;
  now: Date;
}) {
  if (!eventDate) return <span className="muted">Set the date to follow the plan live</span>;
  if (nowSec === null) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate);
    const day = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    const days = day ? Math.ceil((day.getTime() - now.getTime()) / 86_400_000) : 0;
    return <span className="muted">{days > 0 ? `${longDate(eventDate)} — in ${days} day${days === 1 ? '' : 's'}` : longDate(eventDate)}</span>;
  }
  if (onNow === null) {
    const next = sched.rows.findIndex((r) => r.start !== null && r.start > nowSec);
    if (next < 0) return <span className="muted">Show over (as planned)</span>;
    return (
      <span>
        Next <b>{cueLabel(cues[next]!)}</b> in <b className="mono">{formatDuration(sched.rows[next]!.start! - nowSec)}</b>
      </span>
    );
  }
  const r = sched.rows[onNow]!;
  return (
    <span className="status__live">
      <i className="tally" /> On now: <b>{cueLabel(cues[onNow]!)}</b>
      {r.end !== null && (
        <>
          {' '}
          · <b className="mono">{formatDuration(r.end - nowSec)}</b> left
        </>
      )}
    </span>
  );
}

/** The cue sheet: one row per cue, edited in place, dragged to reorder. */
function CueSheet({
  store,
  sched,
  sel,
  onSel,
  canEdit,
  editable = () => canEdit,
  columns: allColumns = [],
  hidden = '',
  onNow,
  commentCount,
  hasStart,
  onOpen,
}: {
  /** Columns this person hid ("type,who,hint,notes" and extra columns' ids). */
  hidden?: string;
  store: PlanStore;
  sched: Schedule;
  sel: string | null;
  onSel: (id: string | null) => void;
  canEdit: boolean;
  /** May this cue be changed here (its section may be locked)? */
  editable?: (c: PlanCue) => boolean;
  /** The plan's extra columns. */
  columns?: CustomColumn[];
  onNow: number | null;
  commentCount: Map<string, number>;
  hasStart: boolean;
  /** Tablets and narrow windows: each row has a button that opens its details. */
  onOpen?: (id: string) => void;
}) {
  const { cues } = store;
  const hiddenList = hidden.split(',');
  const off = (k: string) => hiddenList.includes(k);
  const columns = useMemo(() => allColumns.filter((c) => !hiddenList.includes(c.id)), [allColumns, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const baseOff = BASE_COLUMNS.filter(off).length;
  // Rows drag only by their handle (so text in the cells can still be selected), by mouse, pen or touch.
  const { listRef, handle, rowClass } = useReorder<HTMLTableSectionElement>(cues.length, store.move, canEdit);
  const box = useRef<HTMLDivElement>(null);
  const keys = (e: KeyboardEvent, i: number) => {
    if (!canEdit || !e.altKey) return;
    if (e.key === 'ArrowUp' && i > 0) {
      e.preventDefault();
      store.move(i, i - 1);
    } else if (e.key === 'ArrowDown' && i < cues.length - 1) {
      e.preventDefault();
      store.move(i, i + 1);
    }
  };
  // What the rows do, the same functions every time (so a row only draws again when it changes:
  // typing in one cue does not redraw the other hundreds).
  const live = useRef({ onSel, editCue: store.editCue, keys, handle, onOpen });
  live.current = { onSel, editCue: store.editCue, keys, handle, onOpen };
  const act = useMemo<RowActions>(
    () => ({
      sel: (id) => live.current.onSel(id),
      edit: (id, change) => live.current.editCue(id, change),
      keys: (e, i) => live.current.keys(e, i),
      handle: (i) => ({
        onPointerDown: (e) => live.current.handle(i).onPointerDown(e),
        onPointerMove: (e) => live.current.handle(i).onPointerMove(e),
        onPointerUp: () => live.current.handle(i).onPointerUp(),
        onPointerCancel: () => live.current.handle(i).onPointerCancel(),
        onClick: (e) => live.current.handle(i).onClick(e),
      }),
      open: (id) => live.current.onOpen?.(id),
    }),
    [],
  );

  return (
    <div className="sheet" ref={box}>
      <table className="cues">
        <colgroup>
          <col className="c-handle" />
          <col className="c-n" />
          <col className="c-time" />
          <col className="c-len" />
          {!off('type') && <col className="c-seg" />}
          <col className="c-title" />
          {!off('who') && <col className="c-who" />}
          {!off('hint') && <col className="c-hint" />}
          {!off('notes') && <col className="c-notes" />}
          {columns.map((c) => (
            <col key={c.id} className="c-extra" />
          ))}
          <col className="c-com" />
        </colgroup>
        <thead>
          <tr>
            <th aria-label="Drag to reorder" />
            <th className="num">#</th>
            <th>
              Start
              {!hasStart && cues.length > 0 && (
                <button
                  type="button"
                  className="th__hint"
                  title="Set a start time to see when each cue begins"
                  onClick={() => focusField('#plan-start-wrap input')}
                >
                  set time
                </button>
              )}
            </th>
            <th>Length</th>
            {!off('type') && <th className="th-type">Type</th>}
            <th>Cue</th>
            {!off('who') && <th>Who</th>}
            {!off('hint') && <th className="th-hint">Lumora</th>}
            {!off('notes') && <th className="th-notes">Notes</th>}
            {columns.map((c) => (
              <th key={c.id} className="th-extra">
                {c.name}
              </th>
            ))}
            <th aria-label="Comments" />
          </tr>
        </thead>
        <tbody ref={listRef}>
          {cues.map((c, i) => {
            const t = sched.rows[i]!;
            return (
              <CueRow
                key={c.id}
                c={c}
                i={i}
                section={c.section && c.section !== cues[i - 1]?.section ? c.section : null}
                start={t.start}
                fixed={t.fixed}
                drift={t.drift}
                isSel={sel === c.id}
                isNow={onNow === i}
                extra={rowClass(i)}
                canEdit={editable(c)}
                columns={columns}
                hidden={hidden}
                comments={commentCount.get(c.id) ?? 0}
                canOpen={!!onOpen}
                act={act}
              />
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} />
            <td className="mono">
              <b>{formatDuration(sched.totalSec) || '0:00'}</b>
            </td>
            <td colSpan={6 + columns.length - baseOff} className="muted">
              {cues.length === 0 ? (canEdit ? 'No cues yet: Add cue starts the list.' : 'No cues yet.') : 'Total planned length'}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** The cue sheet's columns a person can hide (besides the extra ones). */
export const BASE_COLUMNS = ['type', 'who', 'hint', 'notes'] as const;
const BASE_NAMES: Record<(typeof BASE_COLUMNS)[number], string> = { type: 'Type', who: 'Who', hint: 'Lumora', notes: 'Notes' };

/** The columns this person hid on this plan (kept on this device). */
function useHidden(planId: string): [string, (v: string) => void] {
  const key = `lumora.planner.hide.${planId}`;
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  });
  const set = (next: string) => {
    setV(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Not remembered: fine.
    }
  };
  return [v, set];
}

/** Which columns show on the cue sheet (for this person, on this device). */
function ColumnsMenu({ hidden, onChange, columns }: { hidden: string; onChange: (v: string) => void; columns: CustomColumn[] }) {
  const [open, setOpen] = useState(false);
  const list = hidden.split(',').filter(Boolean);
  const toggle = (k: string) => onChange((list.includes(k) ? list.filter((x) => x !== k) : [...list, k]).join(','));
  return (
    <div className="account">
      <button type="button" className={`btn btn--quiet${list.length ? ' is-on' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Columns3 size={15} strokeWidth={1.75} aria-hidden="true" />
        Columns{list.length ? ` (${list.length} hidden)` : ''}
      </button>
      {open && (
        <div className="popover popover--menu" role="menu" aria-label="Columns" onMouseLeave={() => setOpen(false)}>
          <p className="muted small popover__note">What you see on this device; others keep their own.</p>
          {[...BASE_COLUMNS.map((k) => [k, BASE_NAMES[k]] as const), ...columns.map((c) => [c.id, c.name || 'Untitled column'] as const)].map(([k, name]) => (
            <label key={k} className="popover__item popover__check">
              <input type="checkbox" checked={!list.includes(k)} onChange={() => toggle(k)} />
              {name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

interface RowActions {
  sel: (id: string) => void;
  edit: (id: string, change: Partial<PlanCue>) => void;
  keys: (e: KeyboardEvent, i: number) => void;
  handle: (i: number) => ReturnType<ReturnType<typeof useReorder>['handle']>;
  open: (id: string) => void;
}

/** One cue in the sheet (and the section heading above it, if it starts one). */
const CueRow = memo(function CueRow({
  c,
  i,
  section,
  start,
  fixed,
  drift,
  isSel,
  isNow,
  extra,
  canEdit,
  comments,
  canOpen,
  act,
  columns,
  hidden,
}: {
  columns: CustomColumn[];
  hidden: string;
  c: PlanCue;
  i: number;
  section: string | null;
  start: number | null;
  fixed: boolean;
  drift: number | null;
  isSel: boolean;
  isNow: boolean;
  extra: string;
  canEdit: boolean;
  comments: number;
  canOpen: boolean;
  act: RowActions;
}) {
  return (
    <>
      {section ? (
        <tr className="cues__section">
          <td colSpan={10 + columns.length - BASE_COLUMNS.filter((k) => hidden.split(',').includes(k)).length}>{section}</td>
        </tr>
      ) : null}
      <tr
        id={`cue-${c.id}`}
        data-reorder
        className={`cues__row${isSel ? ' is-sel' : ''}${isNow ? ' is-now' : ''}${c.segment === 'break' ? ' is-break' : ''}${c.skip ? ' is-skip' : ''}${c.color ? ` cue--${c.color}` : ''}${extra}`}
        onClick={() => act.sel(c.id)}
        onFocus={() => !isSel && act.sel(c.id)}
        onKeyDown={(e) => act.keys(e, i)}
      >
        <td
          className={`handle${canEdit ? '' : ' handle--off'}`}
          {...act.handle(i)}
          title={canEdit ? 'Drag to reorder (or Alt+↑/↓)' : undefined}
          aria-hidden="true"
        >
          {canEdit && <span className="grip" />}
        </td>
        <td className="num mono">
          {isNow && <i className="tally" aria-hidden="true" />}
          {i + 1}
        </td>
        <td className={`mono${fixed ? ' is-fixed' : ''}`}>
          {canEdit ? (
            <ClockInput
              className="cell mono"
              value={c.startTime}
              placeholder={start !== null ? clock12(start) : ''}
              label={`Start of cue ${i + 1}`}
              onChange={(v) => act.edit(c.id, { startTime: v })}
            />
          ) : (
            <span className="cell-text">{start !== null && !c.skip ? clock12(start) : ''}</span>
          )}
          {c.skip && <span className="drift drift--float">floated</span>}
          {drift !== null && drift !== 0 && (
            <span className={`drift ${drift < 0 ? 'drift--over' : ''}`} title={drift < 0 ? 'The cue before runs past this time' : 'A gap before this cue'}>
              {drift < 0 ? `−${formatDuration(-drift)}` : `+${formatDuration(drift)}`}
            </span>
          )}
        </td>
        <td className="mono">
          <DurationInput
            className="cell mono"
            value={c.durationSec}
            readOnly={!canEdit}
            placeholder="—"
            label={`Length of cue ${i + 1}`}
            onChange={(v) => act.edit(c.id, { durationSec: v })}
          />
        </td>
        {!hidden.split(',').includes('type') && (
          <td className="type">
            <select
              className="cell cell--seg"
              value={c.segment}
              disabled={!canEdit}
              aria-label={`Type of cue ${i + 1}`}
              onChange={(e) => act.edit(c.id, { segment: e.target.value as Segment })}
            >
              {SEGMENTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </td>
        )}
        <td>
          <input
            className="cell cell--title"
            value={c.title}
            maxLength={120}
            readOnly={!canEdit}
            placeholder="Untitled cue"
            aria-label={`Cue ${i + 1}`}
            onChange={(e) => act.edit(c.id, { title: e.target.value })}
          />
        </td>
        {!hidden.split(',').includes('who') && (
          <td>
            <input
              className="cell"
              value={c.who}
              maxLength={80}
              readOnly={!canEdit}
              aria-label={`Who for cue ${i + 1}`}
              onChange={(e) => act.edit(c.id, { who: e.target.value })}
            />
          </td>
        )}
        {!hidden.split(',').includes('hint') && <td className="cell-text hint">{hintText(c)}</td>}
        {!hidden.split(',').includes('notes') && <td className="cell-text notes">{c.notes.split('\n')[0]}</td>}
        {columns.map((col) => (
          <td key={col.id} className="extra">
            <input
              className="cell"
              value={c.custom[col.id] ?? ''}
              maxLength={200}
              readOnly={!canEdit}
              aria-label={`${col.name} for cue ${i + 1}`}
              onChange={(e) => act.edit(c.id, { custom: { ...c.custom, [col.id]: e.target.value } })}
            />
          </td>
        ))}
        <td className="num com">
          {canOpen ? (
            <button
              type="button"
              className="com__open"
              aria-label={`Details of cue ${i + 1}${comments ? `, ${comments} comments` : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                act.open(c.id);
              }}
            >
              {comments ? <span className="com__n">{comments}</span> : null}
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          ) : comments ? (
            <span className="com__n">{comments}</span>
          ) : null}
        </td>
      </tr>
    </>
  );
});
