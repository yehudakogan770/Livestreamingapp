// @mentions: "@Dana Levi" in a comment or a chat message tells Dana (when she
// is on the plan). No network and no React here.

export interface Mentionable {
  userId: string;
  name: string;
  email: string;
}

const label = (p: Mentionable): string => (p.name || p.email.split('@')[0] || '').trim();
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ');

/** The people named in a text with "@" (by their full name, first name or email), without `me`. */
export function mentionsIn(text: string, people: readonly Mentionable[], me = ''): string[] {
  const t = norm(text);
  const out = new Set<string>();
  // Longer names first, so "@Dana Levi" is not taken for another Dana.
  const byLength = [...people].sort((a, b) => label(b).length - label(a).length);
  for (const p of byLength) {
    if (p.userId === me) continue;
    const forms = new Set([label(p), label(p).split(' ')[0] ?? '', p.email.split('@')[0] ?? '', p.email].map((f) => norm(f)).filter((f) => f.length >= 2));
    for (const f of forms) {
      let i = t.indexOf(`@${f}`);
      while (i >= 0) {
        const after = t[i + 1 + f.length];
        if (after === undefined || !/[\p{L}\p{N}_]/u.test(after)) {
          out.add(p.userId);
          break;
        }
        i = t.indexOf(`@${f}`, i + 1);
      }
      if (out.has(p.userId)) break;
    }
  }
  return [...out];
}

/** The "@word" being typed at the caret, if any: where it starts and what is typed so far. */
export function typingMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])@([\p{L}\p{N}_.\- ]{0,30})$/u.exec(before);
  if (!m) return null;
  const query = m[2]!;
  // A space ends it unless what comes before could be a first and last name.
  if (/\s{2}/.test(query) || query.split(' ').length > 3) return null;
  return { start: before.length - query.length - 1, query };
}

/** People whose name or email starts with what is typed (first names and last names both count). */
export function matchPeople(people: readonly Mentionable[], query: string, me = ''): Mentionable[] {
  const q = norm(query.trim());
  return people
    .filter((p) => p.userId !== me)
    .filter((p) => !q || norm(label(p)).startsWith(q) || norm(label(p)).split(' ').some((w) => w.startsWith(q)) || norm(p.email).startsWith(q))
    .slice(0, 6);
}

/** The text with the mention typed at `start` replaced by the person's name. */
export function insertMention(text: string, start: number, caret: number, p: Mentionable): { text: string; caret: number } {
  const name = `@${label(p)} `;
  return { text: text.slice(0, start) + name + text.slice(caret), caret: start + name.length };
}

/** Text split into plain parts and @mentions of people on the plan (for showing them bold). */
export function splitMentions(text: string, people: readonly Mentionable[]): { text: string; mention: boolean }[] {
  const names = [...new Set(people.flatMap((p) => [label(p), label(p).split(' ')[0] ?? '']).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  if (!names.length) return [{ text, mention: false }];
  const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(?:${esc.join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  const out: { text: string; mention: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), mention: false });
    out.push({ text: m[0], mention: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false });
  return out;
}
