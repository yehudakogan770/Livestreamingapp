// The Planner's show-day and production tools on the Lumora account server
// (supabase/update-10-planner-pro.sql): calling the show, lists, files,
// versions, templates, the public link, calendar feeds, notifications and
// section locks.

import type { RealtimeChannel } from '@supabase/supabase-js';
import { plain, type Db } from './api';
import { itemFromRow, itemToRow, type Item, type ItemRow } from './items';
import { liveFromRow, logFromRow, type Live, type LiveRow, type LogEntry, type LogRow } from './live';
import { blockFromRow, type Block, type BlockRow } from './blocks';
import { columnsFrom, cueFromRow, type CueRow, type CustomColumn, type Plan, type PlanCue } from './model';

/** Plain words when the server does not have update 10 yet. */
export function proPlain(e: unknown): Error {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (
    /planner_(live|items|files|versions|notifications|sections|feeds|share|public|copy|clock|save_version)/i.test(m) &&
    /could not find|does not exist|schema cache/i.test(m)
  )
    return new Error('This needs the Planner’s show-day update on the Lumora account server. (Its owner runs supabase/update-10-planner-pro.sql once.)');
  return plain(e);
}

async function data<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  let r: { data: unknown; error: unknown };
  try {
    r = await q;
  } catch (e) {
    throw proPlain(e);
  }
  if (r.error) throw proPlain(r.error);
  return r.data as T;
}

// ---- Show day ----

export type LiveAction = 'start' | 'rehearse' | 'go' | 'pause' | 'resume' | 'adjust' | 'end' | 'reset' | 'message' | 'clear';

export interface LiveReply {
  live: Live;
  /** The server's clock when it answered (ms). */
  serverNow: number;
}

export async function liveGo(
  db: Db,
  planId: string,
  action: LiveAction,
  opts: { cue?: string | null; seconds?: number; message?: string; flash?: boolean; source?: 'planner' | 'lumora' } = {},
): Promise<LiveReply> {
  const row = await data<LiveRow>(
    db.rpc('planner_live_go', {
      p: planId,
      p_action: action,
      p_cue: opts.cue ?? null,
      p_seconds: Math.round(opts.seconds ?? 0),
      p_message: opts.message ?? null,
      p_flash: opts.flash ?? false,
      p_source: opts.source ?? 'planner',
    }),
  );
  return { live: liveFromRow(row), serverNow: Date.parse(row.server_now ?? '') || Date.now() };
}

export async function loadLive(db: Db, planId: string): Promise<Live | null> {
  const rows = await data<LiveRow[] | null>(db.from('planner_live').select('*').eq('plan_id', planId));
  return rows?.[0] ? liveFromRow(rows[0]) : null;
}

/** The latest timings (of the last runs), oldest first. */
export async function loadLog(db: Db, planId: string): Promise<LogEntry[]> {
  const rows = await data<LogRow[] | null>(db.from('planner_live_log').select('*').eq('plan_id', planId).order('started_at', { ascending: true }).limit(2000));
  return (rows ?? []).map(logFromRow);
}

export async function clearLog(db: Db, planId: string, runId: string): Promise<void> {
  await data(db.from('planner_live_log').delete().eq('plan_id', planId).eq('run_id', runId));
}

/** The server's clock (ms), and when the question went and the answer came (this device's clock). */
export async function serverClock(db: Db): Promise<{ server: number; sent: number; got: number }> {
  const sent = Date.now();
  const t = await data<string>(db.rpc('planner_clock'));
  return { server: Date.parse(t) || Date.now(), sent, got: Date.now() };
}

/** The show as it is called, and the timings, as they change. */
export function watchLive(db: Db, planId: string, on: { live: (l: Live) => void; log: (e: LogEntry) => void; logGone: (id: string) => void }): () => void {
  const ch: RealtimeChannel = db.channel(`lumora-planner-live:${planId}`);
  const f = `plan_id=eq.${planId}`;
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'planner_live', filter: f }, (p) => {
    if (p.eventType !== 'DELETE') on.live(liveFromRow(p.new as LiveRow));
  })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'planner_live_log', filter: f }, (p) => on.log(logFromRow(p.new as LogRow)))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'planner_live_log', filter: f }, (p) => on.log(logFromRow(p.new as LogRow)))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'planner_live_log' }, (p) => {
      const id = (p.old as { id?: string }).id;
      if (id) on.logGone(id);
    })
    .subscribe();
  return () => void db.removeChannel(ch);
}

// ---- Lists ----

export async function loadItems(db: Db, planId: string): Promise<Item[]> {
  const rows = await data<ItemRow[] | null>(db.from('planner_items').select('*').eq('plan_id', planId).order('sort', { ascending: true }));
  return (rows ?? []).map(itemFromRow);
}

export async function saveItems(db: Db, items: Item[]): Promise<Item[]> {
  if (!items.length) return [];
  const rows = await data<ItemRow[] | null>(db.from('planner_items').upsert(items.map(itemToRow)).select('*'));
  return (rows ?? []).map(itemFromRow);
}

export async function deleteItems(db: Db, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await data(db.from('planner_items').delete().in('id', ids));
}

export async function taskDone(db: Db, id: string, done: boolean): Promise<void> {
  await data(db.rpc('planner_task_done', { p_id: id, p_done: done }));
}

export function watchItems(db: Db, planId: string, on: { item: (i: Item) => void; gone: (id: string) => void }): () => void {
  const ch: RealtimeChannel = db.channel(`lumora-planner-items:${planId}`);
  const f = `plan_id=eq.${planId}`;
  ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'planner_items', filter: f }, (p) => on.item(itemFromRow(p.new as ItemRow)))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'planner_items', filter: f }, (p) => on.item(itemFromRow(p.new as ItemRow)))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'planner_items' }, (p) => {
      const id = (p.old as { id?: string }).id;
      if (id) on.gone(id);
    })
    .subscribe();
  return () => void db.removeChannel(ch);
}

// ---- Files ----

export const FILE_BUCKET = 'planner-files';
export const MAX_FILE = 25 * 1024 * 1024;
export const MAX_PLAN_FILES = 250 * 1024 * 1024;

export interface PlanFile {
  id: string;
  planId: string;
  cueId: string | null;
  name: string;
  size: number;
  mime: string;
  path: string;
  createdAt: number;
  uploadedBy: string;
}

interface FileRow {
  id: string;
  plan_id: string;
  cue_id: string | null;
  name: string;
  size: number;
  mime: string;
  path: string;
  created_at: string;
  uploaded_by_name: string;
}

const fileFromRow = (r: FileRow): PlanFile => ({
  id: r.id,
  planId: r.plan_id,
  cueId: r.cue_id,
  name: r.name,
  size: Number(r.size) || 0,
  mime: r.mime ?? '',
  path: r.path,
  createdAt: Date.parse(r.created_at) || 0,
  uploadedBy: r.uploaded_by_name ?? '',
});

/** A file's name made safe for storage (no slashes; at most 120 characters, keeping the extension). */
export function safeName(name: string): string {
  const clean =
    name
      .replace(/[\\/\u0000-\u001f]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || 'file';
  if (clean.length <= 120) return clean;
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : '';
  return clean.slice(0, 120 - ext.length) + ext;
}

export async function loadFiles(db: Db, planId: string): Promise<PlanFile[]> {
  const rows = await data<FileRow[] | null>(db.from('planner_files').select('*').eq('plan_id', planId).order('created_at', { ascending: true }));
  return (rows ?? []).map(fileFromRow);
}

/** Store a file: its row first (the server checks the limits), then the file; the row goes again if the upload fails. */
export async function uploadFile(db: Db, planId: string, file: File, cueId: string | null, id: string): Promise<PlanFile> {
  if (file.size > MAX_FILE) throw new Error(`“${file.name}” is larger than 25 MB.`);
  const name = safeName(file.name);
  const path = `${planId}/${id}/${name}`;
  const row = await data<FileRow>(
    db
      .from('planner_files')
      .insert({ id, plan_id: planId, cue_id: cueId, name: name.slice(0, 200), size: file.size, mime: (file.type || '').slice(0, 120), path })
      .select('*')
      .single(),
  );
  const up = await db.storage.from(FILE_BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (up.error) {
    await db.from('planner_files').delete().eq('id', id);
    throw proPlain(up.error);
  }
  return fileFromRow(row);
}

/** A link to open or download a file (good for an hour). */
export async function fileLink(db: Db, f: PlanFile, download = false): Promise<string> {
  const r = await db.storage.from(FILE_BUCKET).createSignedUrl(f.path, 3600, download ? { download: f.name } : undefined);
  if (r.error || !r.data) throw proPlain(r.error ?? new Error('No link'));
  return r.data.signedUrl;
}

export async function deleteFile(db: Db, f: PlanFile): Promise<void> {
  const r = await db.storage.from(FILE_BUCKET).remove([f.path]);
  if (r.error && !/not.?found/i.test(r.error.message)) throw proPlain(r.error);
  await data(db.from('planner_files').delete().eq('id', f.id));
}

export async function moveFile(db: Db, id: string, cueId: string | null): Promise<void> {
  await data(db.from('planner_files').update({ cue_id: cueId }).eq('id', id));
}

export function watchFiles(db: Db, planId: string, on: { changed: () => void }): () => void {
  const ch: RealtimeChannel = db.channel(`lumora-planner-files:${planId}`);
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'planner_files', filter: `plan_id=eq.${planId}` }, () => on.changed())
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'planner_files' }, () => on.changed())
    .subscribe();
  return () => void db.removeChannel(ch);
}

/** "2.4 MB" */
export function fileSize(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// ---- Versions ----

export interface Version {
  id: string;
  name: string;
  auto: boolean;
  cueCount: number;
  createdAt: number;
  createdBy: string;
}

export interface VersionContent {
  plan: Partial<Plan>;
  cues: PlanCue[];
  blocks: Block[];
}

export async function listVersions(db: Db, planId: string): Promise<Version[]> {
  const rows = await data<{ id: string; name: string; auto: boolean; cue_count: number; created_at: string; created_by_name: string }[] | null>(
    db
      .from('planner_versions')
      .select('id, name, auto, cue_count, created_at, created_by_name')
      .eq('plan_id', planId)
      .order('created_at', { ascending: false }),
  );
  return (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    auto: r.auto,
    cueCount: r.cue_count,
    createdAt: Date.parse(r.created_at) || 0,
    createdBy: r.created_by_name ?? '',
  }));
}

export async function loadVersion(db: Db, id: string): Promise<VersionContent> {
  const row = await data<{ snapshot: { plan?: Record<string, unknown>; cues?: CueRow[]; schedule?: BlockRow[] } }>(
    db.from('planner_versions').select('snapshot').eq('id', id).single(),
  );
  const p = row.snapshot.plan ?? {};
  return {
    plan: {
      name: String(p.name ?? ''),
      eventDate: String(p.event_date ?? ''),
      venue: String(p.venue ?? ''),
      startTime: String(p.start_time ?? ''),
      notes: String(p.notes ?? ''),
      timeZone: String(p.time_zone ?? ''),
      endBy: String(p.end_by ?? ''),
      columns: columnsFrom(p.columns) as CustomColumn[],
    },
    cues: (row.snapshot.cues ?? []).map(cueFromRow),
    blocks: (row.snapshot.schedule ?? []).map(blockFromRow),
  };
}

export async function saveVersion(db: Db, planId: string, name: string): Promise<string> {
  return data<string>(db.rpc('planner_save_version', { p: planId, p_name: name }));
}

export async function restoreVersion(db: Db, id: string): Promise<void> {
  await data(db.rpc('planner_restore_version', { v: id }));
}

export async function deleteVersion(db: Db, id: string): Promise<void> {
  await data(db.from('planner_versions').delete().eq('id', id));
}

// ---- Templates and copies ----

/** A copy owned by you (a template when `template`); returns the new plan's id. */
export async function copyPlan(db: Db, src: string, name: string, template = false, date = ''): Promise<string> {
  return data<string>(db.rpc('planner_copy_plan', { src, p_name: name, p_template: template, p_date: date || null }));
}

export interface TemplateSummary {
  id: string;
  name: string;
  venue: string;
  updatedAt: number;
}

/** Your templates (and the ones shared with you). */
export async function listTemplates(db: Db): Promise<TemplateSummary[]> {
  try {
    const rows = await data<{ id: string; name: string; venue: string; updated_at: string }[] | null>(
      db.from('planner_plans').select('id, name, venue, updated_at').eq('is_template', true).order('name', { ascending: true }),
    );
    return (rows ?? []).map((r) => ({ id: r.id, name: r.name || 'Untitled template', venue: r.venue ?? '', updatedAt: Date.parse(r.updated_at) || 0 }));
  } catch {
    // Before update 10 there are none.
    return [];
  }
}

// ---- Public link and calendar feeds ----

export async function setShare(db: Db, planId: string, on: boolean, scope: 'agenda' | 'crew'): Promise<string | null> {
  return data<string | null>(db.rpc('planner_share', { p: planId, p_on: on, p_scope: scope }));
}

export interface PublicPlan {
  scope: 'agenda' | 'crew';
  serverNow: number;
  plan: Plan;
  cues: PlanCue[];
  blocks: Block[];
  crew: Item[];
  live: Live | null;
}

interface PublicRow {
  scope: string;
  server_now: string;
  plan: {
    id: string;
    name: string;
    event_date: string | null;
    venue: string;
    start_time: string;
    time_zone: string;
    end_by: string;
    notes: string;
    columns: unknown;
  };
  cues: Partial<CueRow>[];
  schedule: BlockRow[];
  crew: { id: string; title: string; role: string; call_time: string; day: string | null }[];
  live: LiveRow | null;
}

/** What a public link shows, or null when it is off (or wrong). Works signed out. */
export async function loadPublic(db: Db, token: string): Promise<PublicPlan | null> {
  const r = await data<PublicRow | null>(db.rpc('planner_public', { token }));
  if (!r) return null;
  const p = r.plan;
  const plan: Plan = {
    id: p.id,
    owner: '',
    name: p.name ?? '',
    eventDate: p.event_date ?? '',
    venue: p.venue ?? '',
    startTime: p.start_time ?? '',
    notes: p.notes ?? '',
    updatedAt: 0,
    updatedBy: '',
    timeZone: p.time_zone ?? '',
    endBy: p.end_by ?? '',
    columns: columnsFrom(p.columns),
    isTemplate: false,
    shareToken: token,
    shareScope: r.scope === 'crew' ? 'crew' : 'agenda',
    pro: true,
  };
  const cues = (r.cues ?? []).map((c) =>
    cueFromRow({
      plan_id: p.id,
      who: '',
      notes: '',
      input_hint: '',
      overlay_hint: '',
      transition_hint: '',
      ...c,
    } as CueRow),
  );
  return {
    scope: plan.shareScope,
    serverNow: Date.parse(r.server_now) || Date.now(),
    plan,
    cues,
    blocks: (r.schedule ?? []).map((b) => blockFromRow({ ...b, plan_id: p.id, sort: b.sort ?? 0 })),
    crew: (r.crew ?? []).map((c, i) =>
      itemFromRow({
        id: c.id,
        plan_id: p.id,
        kind: 'crew',
        cue_id: null,
        sort: i,
        title: c.title,
        role: c.role,
        person: '',
        person_id: null,
        phone: '',
        email: '',
        call_time: c.call_time,
        day: c.day,
        qty: null,
        amount: null,
        actual: null,
        status: '',
        done: false,
        notes: '',
      }),
    ),
    live: r.live ? liveFromRow({ ...r.live, plan_id: p.id }) : null,
  };
}

/** The address calendar apps subscribe to (iCal), for a plan's public link or your own feed. */
export function feedUrl(baseUrl: string, anonKey: string, fn: 'planner_ical' | 'planner_ical_me', token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/rest/v1/rpc/${fn}?token=${encodeURIComponent(token)}&apikey=${encodeURIComponent(anonKey)}`;
}

export async function myFeed(db: Db, fresh = false): Promise<string> {
  return data<string>(db.rpc('planner_my_feed', { p_new: fresh }));
}

// ---- Notifications ----

export interface Notice {
  id: string;
  planId: string;
  kind: 'mention' | 'task';
  cueId: string | null;
  from: string;
  body: string;
  createdAt: number;
  read: boolean;
}

interface NoticeRow {
  id: string;
  plan_id: string;
  kind: string;
  cue_id: string | null;
  from_name: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

const noticeFromRow = (r: NoticeRow): Notice => ({
  id: r.id,
  planId: r.plan_id,
  kind: r.kind === 'task' ? 'task' : 'mention',
  cueId: r.cue_id,
  from: r.from_name ?? '',
  body: r.body ?? '',
  createdAt: Date.parse(r.created_at) || 0,
  read: r.read_at !== null,
});

export async function loadNotices(db: Db): Promise<Notice[]> {
  const rows = await data<NoticeRow[] | null>(db.from('planner_notifications').select('*').order('created_at', { ascending: false }).limit(100));
  return (rows ?? []).map(noticeFromRow);
}

export async function markRead(db: Db, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await data(db.from('planner_notifications').update({ read_at: new Date().toISOString() }).in('id', ids));
}

export async function clearNotices(db: Db, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await data(db.from('planner_notifications').delete().in('id', ids));
}

export function watchNotices(db: Db, userId: string, on: (n: Notice) => void): () => void {
  const ch: RealtimeChannel = db.channel(`lumora-planner-notices:${userId}`);
  ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'planner_notifications', filter: `user_id=eq.${userId}` }, (p) =>
    on(noticeFromRow(p.new as NoticeRow)),
  ).subscribe();
  return () => void db.removeChannel(ch);
}

// ---- Section locks ----

export interface SectionLock {
  section: string;
  editors: string[];
}

export async function loadLocks(db: Db, planId: string): Promise<SectionLock[]> {
  try {
    const rows = await data<{ section: string; editors: string[] }[] | null>(db.from('planner_sections').select('section, editors').eq('plan_id', planId));
    return (rows ?? []).map((r) => ({ section: r.section, editors: r.editors ?? [] }));
  } catch {
    return [];
  }
}

export async function setLock(db: Db, planId: string, section: string, editors: string[] | null): Promise<void> {
  if (editors === null) await data(db.from('planner_sections').delete().eq('plan_id', planId).eq('section', section));
  else await data(db.from('planner_sections').upsert({ plan_id: planId, section, editors }));
}

export function watchLocks(db: Db, planId: string, on: () => void): () => void {
  const ch: RealtimeChannel = db.channel(`lumora-planner-locks:${planId}`);
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'planner_sections', filter: `plan_id=eq.${planId}` }, () => on()).subscribe();
  return () => void db.removeChannel(ch);
}

/** May someone with this role (and id) change cues in this section? */
export function canEditSection(role: string | null, me: string, section: string, locks: readonly SectionLock[]): boolean {
  if (role === 'owner') return true;
  if (role !== 'editor') return false;
  const l = locks.find((x) => x.section === section);
  return !l || l.editors.includes(me);
}
