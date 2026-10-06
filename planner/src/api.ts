// Lumora Planner on the Lumora account server (Supabase). The tables and rules
// are in supabase/update-5-planner.sql. Lumora uses listPlans and loadPlan too.

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import {
  commentFromRow,
  cueFromRow,
  cueToRow,
  planFromRow,
  summaryFromRow,
  type CommentRow,
  type CueRow,
  type Plan,
  type PlanComment,
  type PlanCue,
  type PlanRow,
  type PlanSummary,
  type Role,
  type SummaryRow,
} from './model';
import { messageFromRow, MAX_MESSAGE, type Message, type MessageRow } from './chatModel';
import { blockFromRow, blockToRow, type Block, type BlockRow } from './blocks';

export type Db = SupabaseClient;

/** Plain words for what went wrong. */
export function plain(e: unknown): Error {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/planner_messages|planner_schedule/i.test(m) && /could not find|does not exist|schema cache/i.test(m))
    return new Error('Chat and schedules are not switched on yet on the Lumora account server. (Its owner runs supabase/update-8-planner.sql once.)');
  if (/too many at once/i.test(m)) return new Error('Too many at once from this account. Please wait a moment and try again.');
  if (/could not find the function|function .* does not exist|relation .* does not exist|schema cache|PGRST20[02]/i.test(m))
    return new Error('The Planner is not switched on yet on the Lumora account server. (Its owner runs supabase/update-5-planner.sql once.)');
  if (/fetch|network|failed to|load failed/i.test(m)) return new Error('Cannot reach the Lumora account server. Check the internet connection and try again.');
  if (/jwt|not authenticated/i.test(m)) return new Error('Please sign in again.');
  if (/row-level security|permission denied/i.test(m)) return new Error('You can view this plan but not change it.');
  return new Error(m);
}

async function data<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  let r: { data: unknown; error: unknown };
  try {
    r = await q;
  } catch (e) {
    throw plain(e);
  }
  if (r.error) throw plain(r.error);
  return r.data as T;
}

/** Plans you own or that were shared with you. */
export async function listPlans(db: Db): Promise<PlanSummary[]> {
  const rows = await data<SummaryRow[] | null>(db.rpc('my_planner_plans'));
  return (rows ?? []).map(summaryFromRow);
}

export interface Loaded {
  plan: Plan;
  cues: PlanCue[];
}

/** A plan and its cues (in order). */
export async function loadPlan(db: Db, id: string): Promise<Loaded> {
  const [plan, cues] = await Promise.all([
    data<PlanRow>(db.from('planner_plans').select('*').eq('id', id).single()),
    data<CueRow[] | null>(db.from('planner_cues').select('*').eq('plan_id', id).order('position', { ascending: true })),
  ]);
  return { plan: planFromRow(plan), cues: (cues ?? []).map(cueFromRow) };
}

export async function loadComments(db: Db, planId: string): Promise<PlanComment[]> {
  const rows = await data<CommentRow[] | null>(db.from('planner_comments').select('*').eq('plan_id', planId).order('created_at', { ascending: true }));
  return (rows ?? []).map(commentFromRow);
}

export async function myRole(db: Db, planId: string): Promise<Role | null> {
  return data<Role | null>(db.rpc('planner_role', { p: planId }));
}

/** A new plan, with you as its owner. */
export async function createPlan(db: Db, name: string, userId: string, eventDate = ''): Promise<Plan> {
  const row = await data<PlanRow>(
    db
      .from('planner_plans')
      .insert({ name: name.trim().slice(0, 120) || 'Untitled plan', owner: userId, ...(eventDate ? { event_date: eventDate } : {}) })
      .select('*')
      .single(),
  );
  return planFromRow(row);
}

export type PlanChange = Partial<Pick<Plan, 'name' | 'eventDate' | 'venue' | 'startTime' | 'notes'>>;

export async function updatePlan(db: Db, id: string, change: PlanChange): Promise<void> {
  const row: Record<string, unknown> = {};
  if (change.name !== undefined) row.name = change.name.slice(0, 120);
  if (change.eventDate !== undefined) row.event_date = change.eventDate || null;
  if (change.venue !== undefined) row.venue = change.venue.slice(0, 120);
  if (change.startTime !== undefined) row.start_time = change.startTime;
  if (change.notes !== undefined) row.notes = change.notes.slice(0, 8000);
  await data(db.from('planner_plans').update(row).eq('id', id));
}

export async function deletePlan(db: Db, id: string): Promise<void> {
  await data(db.from('planner_plans').delete().eq('id', id));
}

/** Save cues as they are now (new or changed); the server stamps when and who. */
export async function saveCues(db: Db, cues: PlanCue[]): Promise<PlanCue[]> {
  if (!cues.length) return [];
  const rows = await data<CueRow[] | null>(db.from('planner_cues').upsert(cues.map(cueToRow)).select('*'));
  return (rows ?? []).map(cueFromRow);
}

export async function deleteCue(db: Db, id: string): Promise<void> {
  await data(db.from('planner_cues').delete().eq('id', id));
}

export async function addComment(db: Db, planId: string, cueId: string, text: string, userId: string): Promise<PlanComment> {
  const row = await data<CommentRow>(
    db
      .from('planner_comments')
      .insert({ plan_id: planId, cue_id: cueId, text: text.trim().slice(0, 2000), author: userId })
      .select('*')
      .single(),
  );
  return commentFromRow(row);
}

export async function deleteComment(db: Db, id: string): Promise<void> {
  await data(db.from('planner_comments').delete().eq('id', id));
}

export interface Person {
  userId: string;
  email: string;
  name: string;
  role: Role;
}

export async function people(db: Db, planId: string): Promise<Person[]> {
  const rows = await data<{ user_id: string; email: string; name: string; role: Role }[] | null>(db.rpc('planner_people', { p_id: planId }));
  return (rows ?? []).map((r) => ({ userId: r.user_id, email: r.email, name: r.name, role: r.role }));
}

/** Share by email. `pending`: there is no account with that email yet; it is added when they make one. */
export async function invite(db: Db, planId: string, email: string, role: 'editor' | 'viewer'): Promise<{ pending: boolean }> {
  const r = await data<{ pending?: boolean } | null>(db.rpc('invite_to_planner', { p_id: planId, p_email: email, p_role: role }));
  return { pending: r?.pending === true };
}

export interface Invitation {
  email: string;
  role: 'editor' | 'viewer';
}

/** Invitations waiting for an account (the owner sees them). */
export async function invitations(db: Db, planId: string): Promise<Invitation[]> {
  try {
    const rows = await data<{ email: string; role: 'editor' | 'viewer' }[] | null>(
      db.from('planner_invites').select('email, role').eq('plan_id', planId).order('created_at', { ascending: true }),
    );
    return (rows ?? []).map((r) => ({ email: r.email, role: r.role }));
  } catch {
    // Before update-6-security.sql there are none.
    return [];
  }
}

export async function cancelInvitation(db: Db, planId: string, email: string): Promise<void> {
  await data(db.from('planner_invites').delete().eq('plan_id', planId).eq('email', email));
}

export async function setRole(db: Db, planId: string, userId: string, role: 'editor' | 'viewer'): Promise<void> {
  await data(db.from('planner_members').update({ role }).eq('plan_id', planId).eq('user_id', userId));
}

export async function removePerson(db: Db, planId: string, userId: string): Promise<void> {
  await data(db.from('planner_members').delete().eq('plan_id', planId).eq('user_id', userId));
}

export interface LiveHandlers {
  cue: (c: PlanCue) => void;
  cueGone: (id: string) => void;
  plan: (p: Plan) => void;
  planGone: () => void;
  comment: (c: PlanComment) => void;
  commentGone: (id: string) => void;
  members: () => void;
  here: (names: string[]) => void;
}

/** Everyone's edits as they happen, and who else has the plan open. */
export function watchPlan(db: Db, planId: string, me: { id: string; name: string }, on: LiveHandlers): () => void {
  const ch: RealtimeChannel = db.channel(`lumora-planner:${planId}`, { config: { presence: { key: me.id } } });
  const f = `plan_id=eq.${planId}`;
  ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'planner_cues', filter: f }, (p) => on.cue(cueFromRow(p.new as CueRow)))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'planner_cues', filter: f }, (p) => on.cue(cueFromRow(p.new as CueRow)))
    // Deleted rows only carry their id (and can't be filtered): unknown ids are ignored.
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'planner_cues' }, (p) => {
      const id = (p.old as { id?: string }).id;
      if (id) on.cueGone(id);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'planner_plans', filter: `id=eq.${planId}` }, (p) =>
      on.plan(planFromRow(p.new as PlanRow)),
    )
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'planner_plans' }, (p) => {
      if ((p.old as { id?: string }).id === planId) on.planGone();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'planner_comments', filter: f }, (p) => on.comment(commentFromRow(p.new as CommentRow)))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'planner_comments' }, (p) => {
      const id = (p.old as { id?: string }).id;
      if (id) on.commentGone(id);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'planner_members', filter: f }, () => on.members())
    .on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<{ name: string }>();
      const names = Object.entries(state)
        .filter(([key]) => key !== me.id)
        .map(([, v]) => v[0]?.name ?? '')
        .filter(Boolean);
      on.here([...new Set(names)]);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') void ch.track({ name: me.name });
    });
  return () => void db.removeChannel(ch);
}

// ---- Chat (supabase/update-8-planner.sql) ----

/** The latest messages on a plan, oldest first. */
export async function loadMessages(db: Db, planId: string, limit = 500): Promise<Message[]> {
  const rows = await data<MessageRow[] | null>(
    db.from('planner_messages').select('*').eq('plan_id', planId).order('created_at', { ascending: false }).limit(limit),
  );
  return (rows ?? []).map(messageFromRow).reverse();
}

export async function sendMessage(db: Db, planId: string, body: string, userId: string): Promise<Message> {
  const row = await data<MessageRow>(
    db
      .from('planner_messages')
      .insert({ plan_id: planId, body: body.trim().slice(0, MAX_MESSAGE), author: userId })
      .select('*')
      .single(),
  );
  return messageFromRow(row);
}

export async function deleteMessage(db: Db, id: string): Promise<void> {
  await data(db.from('planner_messages').delete().eq('id', id));
}

/** New and deleted messages as they happen. */
export function watchChat(db: Db, planId: string, on: { message: (m: Message) => void; gone: (id: string) => void }): () => void {
  const ch: RealtimeChannel = db.channel(`lumora-planner-chat:${planId}`);
  ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'planner_messages', filter: `plan_id=eq.${planId}` }, (p) =>
    on.message(messageFromRow(p.new as MessageRow)),
  )
    // Deleted rows only carry their id (and can't be filtered): unknown ids are ignored.
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'planner_messages' }, (p) => {
      const id = (p.old as { id?: string }).id;
      if (id) on.gone(id);
    })
    .subscribe();
  return () => void db.removeChannel(ch);
}

// ---- Schedule (supabase/update-8-planner.sql) ----

export async function loadBlocks(db: Db, planId: string): Promise<Block[]> {
  const rows = await data<BlockRow[] | null>(db.from('planner_schedule').select('*').eq('plan_id', planId));
  return (rows ?? []).map(blockFromRow);
}

/** Save blocks as they are now (new or changed); the server stamps when and who. */
export async function saveBlocks(db: Db, blocks: Block[]): Promise<Block[]> {
  if (!blocks.length) return [];
  const rows = await data<BlockRow[] | null>(db.from('planner_schedule').upsert(blocks.map(blockToRow)).select('*'));
  return (rows ?? []).map(blockFromRow);
}

export async function deleteBlock(db: Db, id: string): Promise<void> {
  await data(db.from('planner_schedule').delete().eq('id', id));
}

/** Everyone's schedule changes as they happen. */
export function watchBlocks(db: Db, planId: string, on: { block: (b: Block) => void; gone: (id: string) => void }): () => void {
  const ch: RealtimeChannel = db.channel(`lumora-planner-schedule:${planId}`);
  const f = `plan_id=eq.${planId}`;
  ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'planner_schedule', filter: f }, (p) => on.block(blockFromRow(p.new as BlockRow)))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'planner_schedule', filter: f }, (p) => on.block(blockFromRow(p.new as BlockRow)))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'planner_schedule' }, (p) => {
      const id = (p.old as { id?: string }).id;
      if (id) on.gone(id);
    })
    .subscribe();
  return () => void db.removeChannel(ch);
}
