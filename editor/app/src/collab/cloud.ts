// Team projects online (the same Supabase project and accounts as Lumora's
// sign-in). Only the edit goes up, never the media files. The tables and
// rules are in supabase/update-2-editor-collab.sql.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../../../../app/src/auth/auth';
import { readProject } from '../model/build';
import type { Project } from '../model/types';
import { fromRow, type CommentRow, type ReviewComment } from './comments';
import type { LockRow, Role } from './lock';
import { forUpload } from './merge';

export type Db = SupabaseClient;
const db0 = (): Db => supabase();
export const supabaseDb = db0;

/** Plain words for what went wrong. */
export function plain(e: unknown): Error {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/could not find the function|function .* does not exist|relation .* does not exist|schema cache|PGRST20[02]/i.test(m))
    return new Error('Team projects are not switched on yet on the Lumora account server. (Its owner runs supabase/update-2-editor-collab.sql once.)');
  if (/fetch|network|failed to|load failed/i.test(m)) return new Error('Lumora Studio cannot reach the internet. Check the connection and try again.');
  if (/jwt|not authenticated|permission denied/i.test(m)) return new Error('Please sign in again to use team projects.');
  return new Error(m);
}

/** Supabase answers { data, error }; this gives the data or throws plain words. */
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

export interface SharedSummary {
  id: string;
  name: string;
  role: Role;
  ownerName: string;
  version: number;
  updatedAt: number;
  updatedBy: string;
}

/** Projects you own or that were shared with you, newest first. */
export async function listShared(db: Db = db0()): Promise<SharedSummary[]> {
  const rows = await data<{ id: string; name: string; role: Role; owner_name: string; version: number; updated_at: string; updated_by_name: string }[] | null>(
    db.rpc('my_editor_projects'),
  );
  return (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name || 'Untitled',
    role: r.role,
    ownerName: r.owner_name,
    version: r.version,
    updatedAt: Date.parse(r.updated_at) || 0,
    updatedBy: r.updated_by_name,
  }));
}

/** Put a project online, with you as its owner. Returns its id. */
export async function shareProject(project: Project, db: Db = db0()): Promise<string> {
  return data<string>(db.rpc('share_editor_project', { p_name: project.name, p_doc: forUpload(project, null) }));
}

export interface Opened {
  id: string;
  name: string;
  version: number;
  doc: Project;
  role: Role;
  owner: string;
}

const asProject = (doc: unknown): Project => readProject(JSON.stringify(doc));

/** The newest saved version of a shared project, and your role in it. */
export async function openShared(id: string, db: Db = db0()): Promise<Opened> {
  const r = await data<{ id: string; name: string; version: number; doc: unknown; role: Role; owner: string } | null>(
    db.rpc('open_editor_project', { p_id: id }),
  );
  if (!r) throw new Error('This project is not shared with you.');
  return { id: r.id, name: r.name, version: r.version, doc: asProject(r.doc), role: r.role, owner: r.owner };
}

/**
 * Save, if nobody else saved since version `base`: the new version number,
 * or null when someone else saved first.
 */
export async function saveShared(id: string, base: number, doc: Project, opts: { note?: string; keep?: boolean } = {}, db: Db = db0()): Promise<number | null> {
  const v = await data<number | null>(
    db.rpc('save_editor_project', { p_id: id, p_base: base, p_doc: doc, p_name: doc.name, p_note: opts.note ?? '', p_keep: opts.keep ?? false }),
  );
  return typeof v === 'number' ? v : null;
}

/** Just the newest version number (a quick look for other people's saves). */
export async function latestVersion(id: string, db: Db = db0()): Promise<number> {
  const r = await data<{ version: number } | null>(db.from('editor_projects').select('version').eq('id', id).maybeSingle());
  if (!r) throw new Error('This project is not shared with you any more.');
  return r.version;
}

/** Take a project offline for everyone (owner only). */
export async function deleteShared(id: string, db: Db = db0()): Promise<void> {
  await data(db.from('editor_projects').delete().eq('id', id));
}

export interface Person {
  userId: string;
  email: string;
  name: string;
  role: Role;
}

export async function people(id: string, db: Db = db0()): Promise<Person[]> {
  const rows = await data<{ user_id: string; email: string; name: string; role: Role }[] | null>(db.rpc('editor_project_people', { p_id: id }));
  return (rows ?? []).map((r) => ({ userId: r.user_id, email: r.email, name: r.name, role: r.role }));
}

/** Invite an approved Lumora account by email (owner only). */
export async function invite(id: string, email: string, role: 'editor' | 'viewer', db: Db = db0()): Promise<Person> {
  const clean = email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('Type the email of their Lumora account.');
  const r = await data<{ user_id: string; email: string; name: string; role: Role }>(
    db.rpc('invite_to_editor_project', { p_id: id, p_email: clean, p_role: role }),
  );
  return { userId: r.user_id, email: r.email, name: r.name, role: r.role };
}

export async function setRole(id: string, userId: string, role: 'editor' | 'viewer', db: Db = db0()): Promise<void> {
  await data(db.from('editor_project_members').update({ role }).eq('project_id', id).eq('user_id', userId));
}

/** Take someone off the project (or leave it yourself). */
export async function removePerson(id: string, userId: string, db: Db = db0()): Promise<void> {
  await data(db.from('editor_project_members').delete().eq('project_id', id).eq('user_id', userId));
}

export interface VersionInfo {
  /** The history row. */
  id: number;
  version: number;
  name: string;
  savedByName: string;
  savedAt: number;
  note: string;
}

export async function versions(id: string, db: Db = db0()): Promise<VersionInfo[]> {
  const rows = await data<{ id: number; version: number; name: string; saved_by_name: string; saved_at: string; note: string }[] | null>(
    db
      .from('editor_versions')
      .select('id, version, name, saved_by_name, saved_at, note')
      .eq('project_id', id)
      .order('version', { ascending: false })
      .limit(100),
  );
  return (rows ?? []).map((r) => ({
    id: r.id,
    version: r.version,
    name: r.name,
    savedByName: r.saved_by_name,
    savedAt: Date.parse(r.saved_at) || 0,
    note: r.note,
  }));
}

export async function versionDoc(rowId: number, db: Db = db0()): Promise<Project> {
  const r = await data<{ doc: unknown } | null>(db.from('editor_versions').select('doc').eq('id', rowId).maybeSingle());
  if (!r) throw new Error('That version is no longer kept.');
  return asProject(r.doc);
}

/** Take (or renew) the lock on a sequence. The lock as it now stands, and the server's clock. */
export async function takeLock(id: string, seq: string, db: Db = db0()): Promise<{ row: LockRow | null; serverNow: string | undefined }> {
  const r = await data<(LockRow & { server_now?: string }) | null>(db.rpc('take_editor_lock', { p_id: id, p_seq: seq }));
  if (!r) return { row: null, serverNow: undefined };
  const { server_now, ...row } = r;
  return { row, serverNow: server_now };
}

export async function releaseLock(id: string, seq: string, db: Db = db0()): Promise<void> {
  await data(db.rpc('release_editor_lock', { p_id: id, p_seq: seq }));
}
export async function requestLock(id: string, seq: string, db: Db = db0()): Promise<void> {
  await data(db.rpc('request_editor_lock', { p_id: id, p_seq: seq }));
}
export async function handOver(id: string, seq: string, db: Db = db0()): Promise<void> {
  await data(db.rpc('hand_over_editor_lock', { p_id: id, p_seq: seq }));
}

/** Every lock on the project (who is editing which sequence). */
export async function readLocks(id: string, db: Db = db0()): Promise<LockRow[]> {
  return (
    (await data<LockRow[] | null>(
      db.from('editor_locks').select('seq_id, holder, holder_name, expires_at, requested_by, requested_name').eq('project_id', id),
    )) ?? []
  );
}

const COMMENT_COLUMNS = 'id, project_id, seq_id, frame, author, author_name, text, resolved, created_at';

export async function listComments(id: string, db: Db = db0()): Promise<ReviewComment[]> {
  const rows = await data<CommentRow[] | null>(db.from('editor_comments').select(COMMENT_COLUMNS).eq('project_id', id).order('frame'));
  return (rows ?? []).map(fromRow);
}

export async function addComment(id: string, seq: string, frame: number, text: string, db: Db = db0()): Promise<ReviewComment> {
  const row = await data<CommentRow>(
    db
      .from('editor_comments')
      .insert({ project_id: id, seq_id: seq, frame: Math.max(0, Math.round(frame)), text: text.trim() })
      .select(COMMENT_COLUMNS)
      .single(),
  );
  return fromRow(row);
}

export async function setResolved(commentId: string, resolved: boolean, db: Db = db0()): Promise<void> {
  await data(db.from('editor_comments').update({ resolved }).eq('id', commentId));
}

export async function deleteComment(commentId: string, db: Db = db0()): Promise<void> {
  await data(db.from('editor_comments').delete().eq('id', commentId));
}
