// Review comments: a note on one frame of a sequence, by a person, that can
// be marked done (resolved). Kept online and shared with everyone on the project.

export interface ReviewComment {
  id: string;
  seq: string;
  /** Frames from the start of the sequence. */
  frame: number;
  author: string;
  authorName: string;
  text: string;
  resolved: boolean;
  /** ms since 1970. */
  at: number;
}

/** A comment as the server keeps it. */
export interface CommentRow {
  id: string;
  project_id?: string;
  seq_id: string;
  frame: number;
  author: string;
  author_name: string;
  text: string;
  resolved: boolean;
  created_at: string;
}

export const MAX_COMMENT = 2000;

export function fromRow(r: CommentRow): ReviewComment {
  return {
    id: r.id,
    seq: r.seq_id,
    frame: Math.max(0, Math.round(r.frame)),
    author: r.author,
    authorName: r.author_name || 'Someone',
    text: r.text,
    resolved: r.resolved,
    at: Date.parse(r.created_at) || 0,
  };
}

/** What is wrong with the words of a new comment (null: nothing). */
export function checkText(text: string): string | null {
  const t = text.trim();
  if (!t) return 'Type a comment first.';
  if (t.length > MAX_COMMENT) return `A comment can be up to ${MAX_COMMENT} characters.`;
  return null;
}

/** In time order along the sequence (then oldest first). */
export function sortComments(list: ReviewComment[]): ReviewComment[] {
  return [...list].sort((a, b) => a.frame - b.frame || a.at - b.at || a.id.localeCompare(b.id));
}

/** A live change from the server (insert, update or delete). */
export interface CommentChange {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Partial<CommentRow>;
  old: Partial<CommentRow>;
}

/** The list after a live change (changes for other projects are ignored). */
export function applyChange(list: ReviewComment[], change: CommentChange, project: string): ReviewComment[] {
  if (change.eventType === 'DELETE') {
    const id = change.old.id;
    return id && list.some((c) => c.id === id) ? list.filter((c) => c.id !== id) : list;
  }
  const row = change.new;
  if (!row.id || (row.project_id && row.project_id !== project)) return list;
  if (typeof row.seq_id !== 'string' || typeof row.frame !== 'number' || typeof row.text !== 'string') return list;
  const c = fromRow(row as CommentRow);
  return sortComments([...list.filter((x) => x.id !== c.id), c]);
}

/** The comments on one sequence, done ones only if asked for. */
export function forSequence(list: ReviewComment[], seq: string, showResolved: boolean): ReviewComment[] {
  return sortComments(list.filter((c) => c.seq === seq && (showResolved || !c.resolved)));
}

/** A pin on the timeline: the comments on one frame. */
export interface Pin {
  frame: number;
  ids: string[];
  /** All done (shown dimmed). */
  resolved: boolean;
  /** For the tooltip. */
  title: string;
}

/** Pins for a sequence's timeline (one per frame that has comments). */
export function pins(list: ReviewComment[], seq: string): Pin[] {
  const out = new Map<number, Pin>();
  for (const c of sortComments(list.filter((x) => x.seq === seq))) {
    const p = out.get(c.frame) ?? { frame: c.frame, ids: [], resolved: true, title: '' };
    p.ids.push(c.id);
    p.resolved = p.resolved && c.resolved;
    p.title += `${p.title ? '\n' : ''}${c.authorName}: ${c.text.length > 80 ? `${c.text.slice(0, 79)}…` : c.text}${c.resolved ? ' (done)' : ''}`;
    out.set(c.frame, p);
  }
  return [...out.values()];
}

/** How many still need looking at. */
export const openCount = (list: ReviewComment[], seq?: string): number => list.filter((c) => !c.resolved && (seq === undefined || c.seq === seq)).length;
