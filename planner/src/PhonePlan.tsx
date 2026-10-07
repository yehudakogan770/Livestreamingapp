// One plan on a phone: a compact header with the plan's actions, tabs for the
// run of show, the schedule and the chat, what is on now and next (on the
// event day), and the cues as a list of cards. Tapping a cue (or a schedule
// block) opens everything about it in a full-screen sheet.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, Ellipsis, Plus, UserPlus } from 'lucide-react';
import { byDay, isMine, splitRoles } from './blocks';
import { Chat } from './Chat';
import { TimeInput } from './fields';
import { Inspector, hintText, initials } from './Inspector';
import { Mark } from './Mark';
import { clock12, cueLabel, formatDuration, segmentName, shortDate, showClock, type PlanCue, type Schedule } from './model';
import type { PlanTab } from './PlanView';
import { BlockEditor, ScheduleList, useMine } from './Schedule';
import { useBackToClose, useReorder } from './touch';
import type { BlockStore } from './useBlocks';
import type { ChatStore } from './useChat';
import type { PlanStore } from './usePlan';

const ROLE_WORDS = { owner: 'You own this plan', editor: 'You can edit', viewer: 'View only' } as const;
const SAVE_WORDS = { saved: 'Saved', saving: 'Saving…', offline: 'Not saved — retrying' } as const;

export interface PhonePlanProps {
  store: PlanStore;
  sched: Schedule;
  sel: string | null;
  onSel: (id: string | null) => void;
  canEdit: boolean;
  onNow: number | null;
  nowSec: number | null;
  commentCount: Map<string, number>;
  me: { id: string; name: string };
  onBack: () => void;
  onShare: () => void;
  onLeaveOrDelete: () => void;
  tab: PlanTab;
  onTab: (t: PlanTab) => void;
  chat: ChatStore;
  blocks: BlockStore;
  blockSel: string | null;
  onBlockSel: (id: string | null) => void;
  onCue: (n: number) => void;
  onFirstUntimed: () => void;
}

export function PhonePlan({
  store,
  sched,
  sel,
  onSel,
  canEdit,
  onNow,
  nowSec,
  commentCount,
  me,
  onBack,
  onShare,
  onLeaveOrDelete,
  tab,
  onTab,
  chat,
  blocks,
  blockSel,
  onBlockSel,
  onCue,
  onFirstUntimed,
}: PhonePlanProps) {
  const { plan, cues, comments, role, here, saving } = store;
  const [details, setDetails] = useState(false);
  const [menu, setMenu] = useState(false);
  const { mine, setMine, roles, setRoles } = useMine();
  const { listRef, handle, rowClass } = useReorder<HTMLOListElement>(cues.length, store.move, canEdit);
  // The same functions every time, so a card only draws again when it changes.
  const live = useRef({ onSel, handle });
  live.current = { onSel, handle };
  const act = useMemo<CardActions>(
    () => ({
      sel: (id) => live.current.onSel(id),
      handle: (i) => ({
        onPointerDown: (e) => live.current.handle(i).onPointerDown(e),
        onPointerMove: (e) => live.current.handle(i).onPointerMove(e),
        onPointerUp: () => live.current.handle(i).onPointerUp(),
        onPointerCancel: () => live.current.handle(i).onPointerCancel(),
        onClick: (e) => live.current.handle(i).onClick(e),
      }),
    }),
    [],
  );
  const selIndex = cues.findIndex((c) => c.id === sel);
  const selected = selIndex >= 0 ? cues[selIndex]! : null;
  const block = blocks.blocks.find((b) => b.id === blockSel) ?? null;
  useBackToClose(selected !== null, () => onSel(null));
  useBackToClose(block !== null, () => onBlockSel(null));
  useBackToClose(menu, () => setMenu(false));

  // A cue just added or moved is scrolled into view when the sheet closes.
  const lastSel = useRef<string | null>(null);
  useEffect(() => {
    if (sel) lastSel.current = sel;
    else if (lastSel.current) {
      document.getElementById(`cue-${lastSel.current}`)?.scrollIntoView?.({ block: 'nearest' });
      lastSel.current = null;
    }
  }, [sel]);

  // On the event day, open the list at what is on now.
  const scrolledToNow = useRef(false);
  useEffect(() => {
    if (scrolledToNow.current || onNow === null || !cues[onNow]) return;
    scrolledToNow.current = true;
    document.getElementById(`cue-${cues[onNow]!.id}`)?.scrollIntoView?.({ block: 'center' });
  }, [onNow, cues]);

  if (!plan) return null;
  const when = [shortDate(plan.eventDate) || 'No date yet', showClock(plan.startTime), plan.venue].filter(Boolean).join(' · ');
  const add = () => {
    if (tab === 'schedule') onBlockSel(blocks.add(plan.eventDate));
    else {
      const id = store.addCue(sel);
      if (id) onSel(id);
    }
  };
  const shownBlocks = mine ? blocks.blocks.filter((b) => isMine(b, me.name, splitRoles(roles))) : blocks.blocks;

  return (
    <main className={`phone phone--${tab} no-print`}>
      <header className="phone__head">
        <div className="phone__top">
          <a className="phone__back" href="#/" onClick={onBack}>
            <ChevronLeft size={22} strokeWidth={1.75} aria-hidden="true" />
            Plans
          </a>
          <span className="bar__spacer" />
          {here.length > 0 && (
            <span className="tools__here" title={here.join(', ')} aria-label={here.length === 1 ? `${here[0]} is here` : `${here.length} others here`}>
              {here.slice(0, 3).map((n) => (
                <span key={n} className="who-chip">
                  {initials(n)}
                </span>
              ))}
            </span>
          )}
          <span className={`phone__save tools__save--${saving}`} role="status">
            {SAVE_WORDS[saving]}
          </span>
          <nav className="phone__acts" aria-label="Plan actions">
            <button type="button" className="btn btn--quiet btn--icon" onClick={onShare} aria-label="Share">
              <UserPlus size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn--quiet btn--icon"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
              aria-label="More"
            >
              <Ellipsis size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </nav>
        </div>
        <input
          className="phone__name"
          value={plan.name}
          maxLength={120}
          readOnly={!canEdit}
          enterKeyHint="done"
          onChange={(e) => store.editPlan({ name: e.target.value })}
          aria-label="Event name"
          placeholder="Event name"
        />
        <button type="button" className="phone__when" aria-expanded={details} onClick={() => setDetails(!details)}>
          <span className="phone__when-text">{when}</span>
          <span className="phone__when-act">{details ? 'Done' : canEdit ? 'Edit' : 'Details'}</span>
        </button>
        {details && (
          <div className="phone__meta">
            <label className="field">
              <span>Date</span>
              <input
                type="date"
                className="input"
                value={plan.eventDate}
                readOnly={!canEdit}
                onChange={(e) => canEdit && store.editPlan({ eventDate: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Show starts</span>
              <TimeInput value={plan.startTime} readOnly={!canEdit} label="Show starts" onChange={(v) => store.editPlan({ startTime: v })} />
            </label>
            <label className="field phone__wide">
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
            <label className="field phone__wide">
              <span>Event notes</span>
              <textarea
                className="input"
                rows={4}
                maxLength={8000}
                value={plan.notes}
                readOnly={!canEdit}
                placeholder="Contacts, parking, stream details…"
                onChange={(e) => store.editPlan({ notes: e.target.value })}
              />
            </label>
          </div>
        )}
        <div className="seg seg--block phone__tabs" role="tablist" aria-label="Plan">
          <button type="button" role="tab" className={`seg__btn${tab === 'run' ? ' is-on' : ''}`} aria-selected={tab === 'run'} onClick={() => onTab('run')}>
            Run of show
          </button>
          <button
            type="button"
            role="tab"
            className={`seg__btn${tab === 'schedule' ? ' is-on' : ''}`}
            aria-selected={tab === 'schedule'}
            onClick={() => onTab('schedule')}
          >
            Schedule
          </button>
          <button type="button" role="tab" className={`seg__btn${tab === 'chat' ? ' is-on' : ''}`} aria-selected={tab === 'chat'} onClick={() => onTab('chat')}>
            Chat
            {chat.unread > 0 && <span className="seg__n">{chat.unread}</span>}
          </button>
        </div>
      </header>

      {tab === 'run' && nowSec !== null && <NowNext sched={sched} cues={cues} nowSec={nowSec} onNow={onNow} onOpen={onSel} />}
      {store.error && <p className="warn plan__error">{store.error}</p>}

      {tab === 'chat' && (
        <div className="phone__chat">
          <Chat chat={chat} me={me.id} isOwner={role === 'owner'} cueCount={cues.length} onCue={onCue} planName={plan.name} />
        </div>
      )}

      {tab === 'schedule' && (
        <div className="phone__list">
          <div className="seg seg--block phone__mine" role="group" aria-label="Whose schedule">
            <button type="button" className={`seg__btn${mine ? '' : ' is-on'}`} aria-pressed={!mine} onClick={() => setMine(false)}>
              Everyone
            </button>
            <button type="button" className={`seg__btn${mine ? ' is-on' : ''}`} aria-pressed={mine} onClick={() => setMine(true)}>
              My schedule
            </button>
          </div>
          {mine && (
            <label className="field phone__roles">
              <span>Also show blocks for my roles</span>
              <input className="input" value={roles} placeholder="e.g. Audio, Camera" maxLength={120} onChange={(e) => setRoles(e.target.value)} />
            </label>
          )}
          {blocks.error && <p className="warn">{blocks.error}</p>}
          {!blocks.loaded && !blocks.error && <p className="muted">Loading the schedule…</p>}
          {blocks.loaded && blocks.blocks.length === 0 && (
            <div className="empty empty--center phone__empty">
              <Mark size={28} />
              <p>No schedule yet.</p>
              <p className="muted">Crew call, load-in, sound check, doors, show and strike: who, where and when.</p>
            </div>
          )}
          {blocks.loaded && blocks.blocks.length > 0 && shownBlocks.length === 0 && (
            <div className="empty phone__empty">
              <p>Nothing on your schedule.</p>
              <p className="muted">Blocks show here when their “Who” names you, one of your roles, or everyone.</p>
            </div>
          )}
          {shownBlocks.length > 0 && <ScheduleList days={byDay(shownBlocks)} sel={blockSel} onSel={onBlockSel} />}
        </div>
      )}

      {tab === 'run' && (
        <div className="phone__list">
          <ol className="cards" ref={listRef} aria-label="Cues">
            {cues.map((c, i) => {
              const t = sched.rows[i]!;
              return (
                <CueCard
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
                  canEdit={canEdit}
                  comments={commentCount.get(c.id) ?? 0}
                  act={act}
                />
              );
            })}
          </ol>
          {cues.length === 0 ? (
            <div className="empty empty--center phone__empty">
              <Mark size={28} />
              <p>No cues yet.</p>
              {canEdit && <p className="muted">Add cue starts the list: each cue is one moment of the show, in order.</p>}
            </div>
          ) : (
            <p className="phone__totals">
              {cues.length} cue{cues.length === 1 ? '' : 's'} · Total <b>{formatDuration(sched.totalSec) || '0:00'}</b>
              {plan.startTime && sched.endSec !== null && (
                <>
                  {' '}
                  · Ends <b>{clock12(sched.endSec)}</b>
                </>
              )}
              {sched.untimed > 0 && (
                <>
                  {' · '}
                  <button type="button" className="status__link warn-text" onClick={onFirstUntimed}>
                    {sched.untimed} without a length
                  </button>
                </>
              )}
              {!plan.startTime && (
                <>
                  <br />
                  <button type="button" className="status__link" onClick={() => setDetails(true)}>
                    Set a start time to see when each cue begins
                  </button>
                </>
              )}
            </p>
          )}
          <p className="phone__role muted small">{ROLE_WORDS[role ?? 'viewer']}</p>
        </div>
      )}

      {canEdit && tab !== 'chat' && (
        <button type="button" className="fab" onClick={add} aria-label={tab === 'schedule' ? 'Add block' : 'Add cue'}>
          <Plus size={24} strokeWidth={2} aria-hidden="true" />
        </button>
      )}

      {menu && (
        <div className="menu-back" onPointerDown={(e) => e.target === e.currentTarget && setMenu(false)}>
          <div className="menu" role="menu" aria-label="More">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                setDetails(true);
              }}
            >
              Event details and notes
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                window.print();
              }}
            >
              Print or save as PDF
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu__danger"
              onClick={() => {
                setMenu(false);
                onLeaveOrDelete();
              }}
            >
              {role === 'owner' ? 'Delete plan…' : 'Leave plan…'}
            </button>
            <button type="button" role="menuitem" onClick={() => setMenu(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {selected && (
        <div className="cuesheet" role="dialog" aria-modal="true" aria-label={`Cue ${selIndex + 1}`}>
          <header className="cuesheet__head">
            <button type="button" className="btn btn--quiet cuesheet__back" onClick={() => onSel(null)}>
              <ChevronLeft size={22} strokeWidth={1.75} aria-hidden="true" />
              Cues
            </button>
            <b className="cuesheet__title">
              Cue {selIndex + 1} <span className="muted">of {cues.length}</span>
            </b>
            {canEdit && (
              <span className="cuesheet__move">
                <button type="button" className="btn" disabled={selIndex === 0} aria-label="Move cue up" onClick={() => store.move(selIndex, selIndex - 1)}>
                  <ArrowUp size={18} strokeWidth={1.75} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={selIndex === cues.length - 1}
                  aria-label="Move cue down"
                  onClick={() => store.move(selIndex, selIndex + 1)}
                >
                  <ArrowDown size={18} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </span>
            )}
          </header>
          <div className="cuesheet__body">
            <Inspector
              key={selected.id}
              cue={selected}
              index={selIndex}
              count={cues.length}
              store={store}
              canEdit={canEdit}
              comments={comments.filter((c) => c.cueId === selected.id)}
              me={me.id}
              isOwner={role === 'owner'}
              timed={sched.rows[selIndex]}
              onSel={onSel}
              phone
            />
          </div>
          <footer className="cuesheet__foot">
            <span className={`phone__save tools__save--${saving}`}>{canEdit ? SAVE_WORDS[saving] : 'View only'}</span>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                // Commit a field still being typed in before closing.
                (document.activeElement as HTMLElement | null)?.blur?.();
                onSel(null);
              }}
            >
              Done
            </button>
          </footer>
        </div>
      )}

      {block && (
        <div className="cuesheet" role="dialog" aria-modal="true" aria-label="Schedule block">
          <header className="cuesheet__head">
            <button type="button" className="btn btn--quiet cuesheet__back" onClick={() => onBlockSel(null)}>
              <ChevronLeft size={22} strokeWidth={1.75} aria-hidden="true" />
              Schedule
            </button>
            <b className="cuesheet__title">{block.title || 'Untitled block'}</b>
            <span className="cuesheet__move" />
          </header>
          <div className="cuesheet__body">
            <BlockEditor key={block.id} block={block} store={blocks} canEdit={canEdit} onClose={() => onBlockSel(null)} phone />
          </div>
          <footer className="cuesheet__foot">
            <span className="phone__save">{canEdit ? (blocks.error ? 'Not saved — retrying' : 'Saved as you type') : 'View only'}</span>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                (document.activeElement as HTMLElement | null)?.blur?.();
                onBlockSel(null);
              }}
            >
              Done
            </button>
          </footer>
        </div>
      )}
    </main>
  );
}

/** On the event day: what is on now and how long it has left, and what comes next. */
function NowNext({
  sched,
  cues,
  nowSec,
  onNow,
  onOpen,
}: {
  sched: Schedule;
  cues: PlanCue[];
  nowSec: number;
  onNow: number | null;
  onOpen: (id: string) => void;
}) {
  const next = sched.rows.findIndex((r) => r.start !== null && r.start > nowSec);
  const cur = onNow === null ? null : sched.rows[onNow]!;
  if (onNow === null && next < 0) return <div className="nownext nownext--over">Show over (as planned)</div>;
  return (
    <div className="nownext" role="status" aria-label="Now and next">
      {onNow !== null && cur ? (
        <button type="button" className="nownext__now" onClick={() => onOpen(cues[onNow]!.id)}>
          <span className="nownext__label">
            <i className="tally" /> Now
          </span>
          <span className={`nownext__title${cues[onNow]!.title.trim() ? '' : ' is-empty'}`}>{cueLabel(cues[onNow]!)}</span>
          {cur.end !== null && <span className="nownext__time">{formatDuration(cur.end - nowSec)} left</span>}
        </button>
      ) : (
        <span className="nownext__now nownext__now--idle">
          <span className="nownext__label">Now</span>
          <span className="nownext__title muted">Nothing planned</span>
        </span>
      )}
      {next >= 0 && (
        <button type="button" className="nownext__next" onClick={() => onOpen(cues[next]!.id)}>
          <span className="nownext__label">Next</span>
          <span className={`nownext__title${cues[next]!.title.trim() ? '' : ' is-empty'}`}>{cueLabel(cues[next]!)}</span>
          <span className="nownext__time">
            {clock12(sched.rows[next]!.start!)} · in {formatDuration(sched.rows[next]!.start! - nowSec)}
          </span>
        </button>
      )}
    </div>
  );
}

interface CardActions {
  sel: (id: string) => void;
  handle: (i: number) => ReturnType<ReturnType<typeof useReorder>['handle']>;
}

/** One cue in the list (and the section heading above it, if it starts one). */
const CueCard = memo(function CueCard({
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
  comments: n,
  act,
}: {
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
  act: CardActions;
}) {
  const sub = [c.who, hintText(c)].filter(Boolean).join(' · ') || c.notes.split('\n')[0];
  return (
    <>
      {section ? <li className="cards__section">{section}</li> : null}
      <li
        id={`cue-${c.id}`}
        data-reorder
        className={`card${isNow ? ' is-now' : ''}${isSel ? ' is-sel' : ''}${c.segment === 'break' ? ' is-break' : ''}${extra}`}
      >
        <button type="button" className="card__open" onClick={() => act.sel(c.id)} aria-label={`Cue ${i + 1}: ${cueLabel(c)}`}>
          <span className="card__when">
            <span className={`card__time${fixed ? ' is-fixed' : ''}`}>{start !== null ? clock12(start) : '—'}</span>
            <span className="card__len">{formatDuration(c.durationSec) || 'no length'}</span>
          </span>
          <span className="card__main">
            <span className="card__line">
              <span className="card__type">{segmentName(c.segment)}</span>
              {drift !== null && drift !== 0 && (
                <span className={`drift drift--inline${drift < 0 ? ' drift--over' : ''}`}>
                  {drift < 0 ? `runs over ${formatDuration(-drift)}` : `gap ${formatDuration(drift)}`}
                </span>
              )}
              {n ? (
                <span className="com__n" aria-label={`${n} comment${n === 1 ? '' : 's'}`}>
                  {n}
                </span>
              ) : null}
            </span>
            <span className={`card__title${c.title.trim() ? '' : ' is-empty'}`}>{cueLabel(c)}</span>
            {sub && <span className="card__sub">{sub}</span>}
          </span>
        </button>
        {canEdit && (
          <span className="card__grip" {...act.handle(i)} aria-hidden="true" title="Drag to reorder">
            <span className="grip" />
          </span>
        )}
      </li>
    </>
  );
});
