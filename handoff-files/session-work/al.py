import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
def rep(p, old, new):
    s = open(p).read()
    assert old in s, (p, old)
    s = s.replace(old, new, 1)
    open(p, 'w').write(s)

p = 'app/src/engine/chat.ts'
rep(p, """  /** The name's color on Twitch. */
  color?: string;
  at: number;
}""", """  /** The name's color on Twitch. */
  color?: string;
  /** Support from a viewer: a Super Chat, a new member or subscriber, bits, a raid. */
  badge?: string;
  at: number;
}""")
rep(p, """/** One line of Twitch chat (IRC with tags), or null if it isn't a chat message. */
export function parseTwitch(line: string): Omit<ChatMessage, 'at' | 'platform'> | null {
  const m = /^(?:@(\\S+) )?:(\\w+)!\\S+ PRIVMSG #\\S+ :(.*)$/.exec(line.trim());
  if (!m) return null;
  const tags = Object.fromEntries((m[1] ?? '').split(';').map((kv) => kv.split('=') as [string, string]));
  const unescape = (v: string) => v.replace(/\\\\s/g, ' ').replace(/\\\\:/g, ';').replace(/\\\\\\\\/g, '\\\\');""",
"""/** What Twitch's notices are called on screen (subscriptions, gifts, raids). */
const TWITCH_NOTICES: Record<string, string> = {
  sub: 'New subscriber',
  resub: 'Subscribed again',
  subgift: 'Gift subscription',
  submysterygift: 'Gift subscriptions',
  raid: 'Raid',
  primepaidupgrade: 'New subscriber',
  giftpaidupgrade: 'New subscriber',
};

/** One line of Twitch chat (IRC with tags), or null if it isn't a chat message. */
export function parseTwitch(line: string): Omit<ChatMessage, 'at' | 'platform'> | null {
  const unescape = (v: string) => v.replace(/\\\\s/g, ' ').replace(/\\\\:/g, ';').replace(/\\\\\\\\/g, '\\\\');
  const notice = /^@(\\S+) :tmi\\.twitch\\.tv USERNOTICE #\\S+(?: :(.*))?$/.exec(line.trim());
  if (notice) {
    const tags = Object.fromEntries(notice[1]!.split(';').map((kv) => kv.split('=') as [string, string]));
    const badge = TWITCH_NOTICES[tags['msg-id'] ?? ''];
    if (!badge) return null;
    return {
      id: tags['id'] || `notice-${Math.random().toString(36).slice(2)}`,
      author: unescape(tags['display-name'] || tags['login'] || 'Someone'),
      text: notice[2] || unescape(tags['system-msg'] ?? ''),
      color: tags['color'] || undefined,
      badge,
    };
  }
  const m = /^(?:@(\\S+) )?:(\\w+)!\\S+ PRIVMSG #\\S+ :(.*)$/.exec(line.trim());
  if (!m) return null;
  const tags = Object.fromEntries((m[1] ?? '').split(';').map((kv) => kv.split('=') as [string, string]));""")
rep(p, """  return {
    id: tags['id'] || `${m[2]}-${Math.random().toString(36).slice(2)}`,
    author: unescape(tags['display-name'] || m[2] || ''),
    text,
    color: tags['color'] || undefined,
  };
}""", """  const bits = Number(tags['bits']);
  return {
    id: tags['id'] || `${m[2]}-${Math.random().toString(36).slice(2)}`,
    author: unescape(tags['display-name'] || m[2] || ''),
    text,
    color: tags['color'] || undefined,
    ...(bits > 0 ? { badge: `${bits} bits` } : {}),
  };
}

/** One YouTube live chat item as the API sends it. */
export interface YoutubeItem {
  id: string;
  snippet: {
    type?: string;
    displayMessage?: string;
    superChatDetails?: { amountDisplayString?: string; userComment?: string };
    superStickerDetails?: { amountDisplayString?: string };
    membershipGiftingDetails?: { giftMembershipsCount?: number };
  };
  authorDetails: { displayName: string };
}

/** A YouTube chat item as a message (null: nothing to show). */
export function parseYoutube(i: YoutubeItem, at: number): ChatMessage | null {
  const s = i.snippet;
  const base = { id: i.id, platform: 'youtube' as const, author: i.authorDetails.displayName, at };
  switch (s.type) {
    case 'superChatEvent':
      return { ...base, text: s.superChatDetails?.userComment || '', badge: `Super Chat ${s.superChatDetails?.amountDisplayString ?? ''}`.trim() };
    case 'superStickerEvent':
      return { ...base, text: '', badge: `Super Sticker ${s.superStickerDetails?.amountDisplayString ?? ''}`.trim() };
    case 'newSponsorEvent':
      return { ...base, text: s.displayMessage ?? '', badge: 'New member' };
    case 'memberMilestoneChatEvent':
      return { ...base, text: s.displayMessage ?? '', badge: 'Member' };
    case 'membershipGiftingEvent':
      return { ...base, text: '', badge: `Gifted ${s.membershipGiftingDetails?.giftMembershipsCount ?? ''} memberships`.replace('  ', ' ') };
    default:
      return s.displayMessage ? { ...base, text: s.displayMessage } : null;
  }
}

/** The words a thank-you puts on screen for a viewer's support. */
export function thanksText(m: ChatMessage): string {
  return m.text ? `${m.badge} · ${m.text}` : `Thank you! ${m.badge}`;
}""")
rep(p, """            items?: { id: string; snippet: { displayMessage?: string }; authorDetails: { displayName: string } }[];
          };
          if (r.error) return fail(`YouTube said: ${r.error.message}`);
          const now = Date.now();
          this.add(
            (r.items ?? [])
              .filter((i) => i.snippet.displayMessage)
              .map((i) => ({ id: i.id, platform: 'youtube' as const, author: i.authorDetails.displayName, text: i.snippet.displayMessage ?? '', at: now })),
          );""", """            items?: YoutubeItem[];
          };
          if (r.error) return fail(`YouTube said: ${r.error.message}`);
          const now = Date.now();
          this.add((r.items ?? []).flatMap((i) => parseYoutube(i, now) ?? []));""")
