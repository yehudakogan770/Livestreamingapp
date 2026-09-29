// Live chat: reads the comments of the live stream on Twitch (no account
// needed) and YouTube (with a free API key from Google). This is the only
// part of Lumora that uses the internet, and only while a chat is connected.
// The chat stays in the control window; a chosen comment goes on screen
// through a comment input.

import { useSyncExternalStore } from 'react';
import type { ChatPlatform } from './types/ChatPlatform';

export interface ChatMessage {
  id: string;
  platform: ChatPlatform;
  author: string;
  text: string;
  /** The name's colour on Twitch. */
  color?: string;
  at: number;
}

export interface ChatState {
  messages: ChatMessage[];
  twitch: { channel: string; status: 'off' | 'connecting' | 'on' | 'error'; problem: string | null };
  youtube: { video: string; status: 'off' | 'connecting' | 'on' | 'error'; problem: string | null };
}

const KEEP = 300;

/** One line of Twitch chat (IRC with tags), or null if it isn't a chat message. */
export function parseTwitch(line: string): Omit<ChatMessage, 'at' | 'platform'> | null {
  const m = /^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\S+ :(.*)$/.exec(line.trim());
  if (!m) return null;
  const tags = Object.fromEntries((m[1] ?? '').split(';').map((kv) => kv.split('=') as [string, string]));
  const unescape = (v: string) => v.replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\');
  let text = m[3] ?? '';
  // "/me" messages.
  const action = /^\u0001ACTION (.*)\u0001$/.exec(text);
  if (action) text = action[1] ?? '';
  return {
    id: tags['id'] || `${m[2]}-${Math.random().toString(36).slice(2)}`,
    author: unescape(tags['display-name'] || m[2] || ''),
    text,
    color: tags['color'] || undefined,
  };
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
  };
  private readonly subs = new Set<() => void>();
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
            items?: { id: string; snippet: { displayMessage?: string }; authorDetails: { displayName: string } }[];
          };
          if (r.error) return fail(`YouTube said: ${r.error.message}`);
          const now = Date.now();
          this.add(
            (r.items ?? [])
              .filter((i) => i.snippet.displayMessage)
              .map((i) => ({ id: i.id, platform: 'youtube' as const, author: i.authorDetails.displayName, text: i.snippet.displayMessage ?? '', at: now })),
          );
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
}

export const chat = new ChatHub();

export function useChat(): ChatState {
  return useSyncExternalStore(chat.subscribe, () => chat.state);
}
