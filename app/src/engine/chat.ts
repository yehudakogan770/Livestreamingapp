// Live chat: reads the comments of the live stream on Twitch (no account
// needed), YouTube (with a free API key from Google) and Facebook (the live
// video Lumora made through the connected Facebook account). This part of
// Lumora uses the internet only while a chat is connected.
// The chat stays in the control window; a chosen comment goes on screen
// through a comment input.

import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ChatPlatform } from './types/ChatPlatform';

export interface ChatMessage {
  id: string;
  platform: ChatPlatform;
  author: string;
  text: string;
  /** The name's color on Twitch. */
  color?: string;
  /** Support from a viewer: a Super Chat, a new member or subscriber, bits, a raid. */
  badge?: string;
  at: number;
}

export interface ChatState {
  messages: ChatMessage[];
  twitch: { channel: string; status: 'off' | 'connecting' | 'on' | 'error'; problem: string | null };
  youtube: { video: string; status: 'off' | 'connecting' | 'on' | 'error'; problem: string | null };
  facebook: { status: 'off' | 'connecting' | 'on' | 'error'; problem: string | null };
}

/** What the app answers with (see `accounts_facebook_comments` in src-tauri/src/accounts.rs). */
export interface FacebookComments {
  comments: { id: string; author: string; text: string }[];
  after: string;
}

/** Asks the app for Facebook comments after a cursor. */
export type FacebookFetch = (after: string) => Promise<FacebookComments>;

const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const appFetch: FacebookFetch = (after) => invoke<FacebookComments>('accounts_facebook_comments', { after });

/** How often Facebook is asked (it allows about 200 calls an hour per person). */
export const FACEBOOK_POLL_MS = 5000;

const KEEP = 300;

/** What Twitch's notices are called on screen (subscriptions, gifts, raids). */
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
  const unescape = (v: string) => v.replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\');
  const notice = /^@(\S+) :tmi\.twitch\.tv USERNOTICE #\S+(?: :(.*))?$/.exec(line.trim());
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
  const m = /^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\S+ :(.*)$/.exec(line.trim());
  if (!m) return null;
  const tags = Object.fromEntries((m[1] ?? '').split(';').map((kv) => kv.split('=') as [string, string]));
  let text = m[3] ?? '';
  // "/me" messages.
  const action = /^\u0001ACTION (.*)\u0001$/.exec(text);
  if (action) text = action[1] ?? '';
  const bits = Number(tags['bits']);
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
}

/** The video id in a YouTube address (or the id itself). */
export function youtubeVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = /(?:youtu\.be\/|[?&]v=|\/live\/|\/shorts\/|\/embed\/)([\w-]{11})/.exec(s);
  return m ? m[1]! : null;
}

/** The channel name in a Twitch address (or the name itself). */
export function twitchChannel(input: string): string | null {
  const s = input
    .trim()
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '')
    .split(/[/?#]/)[0]!
    .toLowerCase();
  return /^\w{2,25}$/.test(s) ? s : null;
}

class ChatHub {
  state: ChatState = {
    messages: [],
    twitch: { channel: '', status: 'off', problem: null },
    youtube: { video: '', status: 'off', problem: null },
    facebook: { status: 'off', problem: null },
  };
  private readonly subs = new Set<() => void>();
  private fb: { stop: boolean } | null = null;
  private ws: WebSocket | null = null;
  private yt: { stop: boolean } | null = null;

  subscribe = (f: () => void) => {
    this.subs.add(f);
    return () => this.subs.delete(f);
  };

  private set(p: Partial<ChatState>) {
    this.state = { ...this.state, ...p };
    this.subs.forEach((f) => f());
  }

  private add(msgs: ChatMessage[]) {
    if (!msgs.length) return;
    const seen = new Set(this.state.messages.map((m) => m.id));
    const fresh = msgs.filter((m) => !seen.has(m.id));
    if (fresh.length) this.set({ messages: [...this.state.messages, ...fresh].slice(-KEEP) });
  }

  clear() {
    this.set({ messages: [] });
  }

  // ---- Twitch: read-only, anonymous ----

  connectTwitch(input: string) {
    const channel = twitchChannel(input);
    this.disconnectTwitch();
    if (!channel) {
      this.set({ twitch: { channel: input, status: 'error', problem: 'That is not a Twitch channel name.' } });
      return;
    }
    this.set({ twitch: { channel, status: 'connecting', problem: null } });
    const open = () => {
      const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
      this.ws = ws;
      ws.onopen = () => {
        ws.send('CAP REQ :twitch.tv/tags');
        ws.send('PASS SCHMOOPIIE');
        ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
        ws.send(`JOIN #${channel}`);
      };
      ws.onmessage = (e) => {
        const now = Date.now();
        const got: ChatMessage[] = [];
        for (const line of String(e.data).split('\r\n')) {
          if (line.startsWith('PING')) ws.send(line.replace('PING', 'PONG'));
          else if (/ JOIN #/.test(line) || / 366 /.test(line)) this.set({ twitch: { channel, status: 'on', problem: null } });
          const m = parseTwitch(line);
          if (m) got.push({ ...m, platform: 'twitch', at: now });
        }
        this.add(got);
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        // Dropped: try again in a few seconds.
        this.set({ twitch: { channel, status: 'connecting', problem: 'The chat connection dropped; trying again…' } });
        setTimeout(() => this.ws === ws && open(), 3000);
      };
    };
    open();
  }

  disconnectTwitch() {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.set({ twitch: { ...this.state.twitch, status: 'off', problem: null } });
  }

  // ---- YouTube: the live chat of a live video, with an API key ----

  connectYoutube(input: string, apiKey: string) {
    this.disconnectYoutube();
    const video = youtubeVideoId(input);
    if (!video) {
      this.set({ youtube: { video: input, status: 'error', problem: 'That is not a YouTube video address.' } });
      return;
    }
    if (!apiKey.trim()) {
      this.set({ youtube: { video, status: 'error', problem: 'YouTube needs an API key (see below).' } });
      return;
    }
    const job = { stop: false };
    this.yt = job;
    this.set({ youtube: { video, status: 'connecting', problem: null } });
    const api = 'https://www.googleapis.com/youtube/v3';
    const key = encodeURIComponent(apiKey.trim());
    const fail = (problem: string) => !job.stop && this.set({ youtube: { video, status: 'error', problem } });
    void (async () => {
      try {
        const v = (await (await fetch(`${api}/videos?part=liveStreamingDetails&id=${video}&key=${key}`)).json()) as {
          error?: { message: string };
          items?: { liveStreamingDetails?: { activeLiveChatId?: string } }[];
        };
        if (v.error) return fail(`YouTube said: ${v.error.message}`);
        const chat = v.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
        if (!chat) return fail('That video is not live now (or its chat is off).');
        this.set({ youtube: { video, status: 'on', problem: null } });
        let page = '';
        while (!job.stop) {
          const r = (await (
            await fetch(`${api}/liveChat/messages?liveChatId=${chat}&part=snippet,authorDetails&maxResults=200&key=${key}${page ? `&pageToken=${page}` : ''}`)
          ).json()) as {
            error?: { message: string };
            nextPageToken?: string;
            pollingIntervalMillis?: number;
            items?: YoutubeItem[];
          };
          if (r.error) return fail(`YouTube said: ${r.error.message}`);
          const now = Date.now();
          this.add((r.items ?? []).flatMap((i) => parseYoutube(i, now) ?? []));
          page = r.nextPageToken ?? page;
          // Asking less often keeps within YouTube's free daily allowance.
          await new Promise((res) => setTimeout(res, Math.max(8000, r.pollingIntervalMillis ?? 0)));
        }
      } catch {
        fail('Can’t reach YouTube: is this computer on the internet?');
      }
    })();
  }

  disconnectYoutube() {
    if (this.yt) this.yt.stop = true;
    this.yt = null;
    this.set({ youtube: { ...this.state.youtube, status: 'off', problem: null } });
  }

  // ---- Facebook: the comments on the live video made through the account ----

  /**
   * Read the comments while going live on Facebook through the connected
   * account. Until the stream is on, it waits and keeps asking.
   */
  connectFacebook(fetchComments: FacebookFetch | null = inApp() ? appFetch : null, waitMs = FACEBOOK_POLL_MS) {
    this.disconnectFacebook();
    if (!fetchComments) {
      this.set({ facebook: { status: 'error', problem: 'Facebook comments work in the Lumora app, with a connected Facebook account.' } });
      return;
    }
    const job = { stop: false };
    this.fb = job;
    this.set({ facebook: { status: 'connecting', problem: null } });
    void (async () => {
      let after = '';
      while (!job.stop) {
        try {
          const r = await fetchComments(after);
          if (job.stop) return;
          after = r.after;
          const now = Date.now();
          this.add(r.comments.map((c) => ({ id: `fb-${c.id}`, platform: 'facebook' as const, author: c.author, text: c.text, at: now })));
          if (this.state.facebook.status !== 'on') this.set({ facebook: { status: 'on', problem: null } });
        } catch (e) {
          if (job.stop) return;
          // Not live yet, or a passing problem: said, and asked again.
          this.set({ facebook: { status: 'connecting', problem: e instanceof Error ? e.message : String(e) } });
        }
        await new Promise((res) => setTimeout(res, waitMs));
      }
    })();
  }

  disconnectFacebook() {
    if (this.fb) this.fb.stop = true;
    this.fb = null;
    this.set({ facebook: { status: 'off', problem: null } });
  }
}

export const chat = new ChatHub();

/** A separate hub, for tests. */
export const newChatHub = () => new ChatHub();

export function useChat(): ChatState {
  return useSyncExternalStore(chat.subscribe, () => chat.state);
}
