import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
p = 'app/src/engine/chat.ts'
s = open(p).read()
def rep(old, new):
    global s
    assert old in s, old
    s = s.replace(old, new, 1)

rep("""// Live chat: reads the comments of the live stream on Twitch (no account
// needed) and YouTube (with a free API key from Google). This is the only
// part of Lumora that uses the internet, and only while a chat is connected.""",
"""// Live chat: reads the comments of the live stream on Twitch (no account
// needed), YouTube (with a free API key from Google) and Facebook (the live
// video Lumora made through the connected Facebook account). This part of
// Lumora uses the internet only while a chat is connected.""")
rep("""import { useSyncExternalStore } from 'react';""", """import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';""")
rep("""  youtube: { video: string; status: 'off' | 'connecting' | 'on' | 'error'; problem: string | null };
}""", """  youtube: { video: string; status: 'off' | 'connecting' | 'on' | 'error'; problem: string | null };
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
export const FACEBOOK_POLL_MS = 5000;""")
rep("""    youtube: { video: '', status: 'off', problem: null },
  };
  private readonly subs = new Set<() => void>();""", """    youtube: { video: '', status: 'off', problem: null },
    facebook: { status: 'off', problem: null },
  };
  private readonly subs = new Set<() => void>();
  private fb: { stop: boolean } | null = null;""")
rep("""  disconnectYoutube() {
    if (this.yt) this.yt.stop = true;
    this.yt = null;
    this.set({ youtube: { ...this.state.youtube, status: 'off', problem: null } });
  }
}""", """  disconnectYoutube() {
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
}""")
rep("""export const chat = new ChatHub();""", """export const chat = new ChatHub();

/** A separate hub, for tests. */
export const newChatHub = () => new ChatHub();""")
open(p, 'w').write(s)
