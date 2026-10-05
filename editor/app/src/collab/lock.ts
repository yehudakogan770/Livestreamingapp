// One person edits a sequence at a time. The lock lives online with an
// end time; the holder keeps pushing it on (a heartbeat), so if their
// computer goes quiet the sequence frees itself within a minute.

import type { Project } from '../model/types';
import { changedSequences, realChange } from './merge';

/** How long a lock lasts without a heartbeat (the server uses the same). */
export const LOCK_SECONDS = 60;
/** How often the holder renews it, and others look again. */
export const HEARTBEAT_MS = 20_000;

export type Role = 'owner' | 'editor' | 'viewer';
export const canEdit = (r: Role): boolean => r !== 'viewer';

/** A lock as the server keeps it. */
export interface LockRow {
  seq_id: string;
  holder: string;
  holder_name: string;
  /** ISO time. */
  expires_at: string;
  requested_by: string | null;
  requested_name: string;
}

export type LockView = { kind: 'free' } | { kind: 'mine'; askedBy: string | null } | { kind: 'theirs'; name: string; askedByMe: boolean; until: number };

/**
 * What a lock means for me now. `now` is my clock corrected to the server's
 * (see clockSkew), so a lock that ran out shows as free.
 */
export function lockView(row: LockRow | null | undefined, me: string, now: number): LockView {
  if (!row) return { kind: 'free' };
  const until = Date.parse(row.expires_at);
  if (!Number.isFinite(until) || until <= now) return { kind: 'free' };
  if (row.holder === me) return { kind: 'mine', askedBy: row.requested_by && row.requested_by !== me ? row.requested_name || 'Someone' : null };
  return { kind: 'theirs', name: row.holder_name || 'Someone', askedByMe: row.requested_by === me, until };
}

/** How far my clock is behind the server's (ms to add to Date.now()). */
export function clockSkew(serverNow: string | undefined, localNow: number): number {
  const t = serverNow ? Date.parse(serverNow) : NaN;
  return Number.isFinite(t) ? t - localNow : 0;
}

/**
 * May this change be made? Null when it may; otherwise why not, in plain
 * words. Changes that would not be saved (the playhead, which sequence is
 * open, where files are on this computer) are always fine. Editors may change
 * the bins and media freely (they are joined by id), but a sequence only
 * while they hold its lock; new sequences are theirs.
 */
export function editGate(before: Project, after: Project, role: Role, blocked: (seqId: string) => string | null): string | null {
  if (!realChange(before, after)) return null;
  if (!canEdit(role)) return 'You can view this project but not change it.';
  for (const id of changedSequences(before, after)) {
    if (!before.sequences.some((s) => s.id === id)) continue;
    const why = blocked(id);
    if (why) return why;
  }
  return null;
}

/** Why a sequence can't be changed right now (null: it can). */
export function lockReason(view: LockView, seqName: string, isOpen: boolean, online: boolean): string | null {
  if (view.kind === 'mine') return null;
  if (view.kind === 'theirs') return `${view.name} is editing “${seqName}”.`;
  if (!online) return 'Lumora Studio cannot reach the internet, so editing this shared project is paused.';
  return isOpen ? `Getting “${seqName}” ready to edit… try again in a moment.` : `Open “${seqName}” to edit it.`;
}
