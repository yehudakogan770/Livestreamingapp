// A plan's chat: messages as the app uses them, the rows they are stored as
// (supabase/update-8-planner.sql), unread counts and cue mentions ("#4").
// No network and no React here.

export interface Message {
  id: string;
  planId: string;
  author: string;
  authorName: string;
  body: string;
  createdAt: number;
}

export interface MessageRow {
  id: string;
  plan_id: string;
  author: string;
  author_name?: string;
  body: string;
  created_at: string;
}

export const MAX_MESSAGE = 2000;

export function messageFromRow(r: MessageRow): Message {
  return {
    id: r.id,
    planId: r.plan_id,
    author: r.author,
    authorName: r.author_name ?? '',
    body: r.body ?? '',
    createdAt: r.created_at ? Date.parse(r.created_at) || 0 : 0,
  };
}

/** Oldest first; a message already in the list (sent here, then heard back live) is not added twice. */
export function addMessage(list: readonly Message[], m: Message): Message[] {
  if (list.some((x) => x.id === m.id)) return [...list];
  return [...list, m].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Messages from others since `seenAt` (ms). */
export function unreadCount(list: readonly Message[], me: string, seenAt: number): number {
  return list.filter((m) => m.author !== me && m.createdAt > seenAt).length;
}

/** Who may delete a message: its author, or the plan's owner. */
export const mayDelete = (m: Message, me: string, isOwner: boolean): boolean => isOwner || m.author === me;

export type Part = { text: string } | { cue: number; text: string };

/** "Move #4 after #12" → text and cue mentions (1-based cue numbers that exist). */
export function parseMentions(body: string, cueCount: number): Part[] {
  const parts: Part[] = [];
  const re = /(^|[^\w&])#(\d{1,4})\b/g;
  let last = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const n = Number(m[2]);
    if (n < 1 || n > cueCount) continue;
    const at = m.index + m[1]!.length;
    if (at > last) parts.push({ text: body.slice(last, at) });
    parts.push({ cue: n, text: `#${n}` });
    last = at + 1 + m[2]!.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

/** Show the name and time only when the author changes or five minutes have passed. */
export function startsGroup(list: readonly Message[], i: number): boolean {
  const m = list[i]!;
  const prev = list[i - 1];
  if (!prev) return true;
  if (prev.author !== m.author) return true;
  if (m.createdAt - prev.createdAt > 5 * 60_000) return true;
  return dayKey(prev.createdAt) !== dayKey(m.createdAt);
}

const dayKey = (ms: number): string => new Date(ms).toDateString();

/** A divider before the first message of each day. */
export const startsDay = (list: readonly Message[], i: number): boolean => i === 0 || dayKey(list[i - 1]!.createdAt) !== dayKey(list[i]!.createdAt);

/** "Today", "Yesterday" or "Tue, Oct 6". */
export function dayLabel(ms: number, now = new Date()): string {
  const d = new Date(ms);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (that === today) return 'Today';
  if (that === today - 86_400_000) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "7:41 PM". */
export const timeLabel = (ms: number): string => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// When the chat was last read on this device, per plan.
const SEEN_KEY = 'lumora.planner.chatSeen.';
export function loadSeen(planId: string): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY + planId)) || 0;
  } catch {
    return 0;
  }
}
export function saveSeen(planId: string, at: number): void {
  try {
    localStorage.setItem(SEEN_KEY + planId, String(at));
  } catch {
    // Not remembered: the count comes back next time.
  }
}
