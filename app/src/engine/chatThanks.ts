// Thank-yous on screen by themselves: when a viewer sends a Super Chat,
// becomes a member or subscriber, cheers bits or raids, their name and what
// they sent show on the chat comments card for a few seconds, one after
// another. Off unless the operator turns it on; plain comments never go on
// screen by themselves.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { chat, thanksText, type ChatMessage } from './chat';
import type { Action } from './types/Action';
import type { ChatComment } from './types/ChatComment';
import type { Show } from './types/Show';

const KEY = 'lumora.chatThanks';
/** How long each thank-you stays on screen. */
export const THANKS_MS = 8000;

let on = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();
const subs = new Set<() => void>();

export function thanksOn(): boolean {
  return on;
}

export function setThanksOn(v: boolean): void {
  on = v;
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    // Kept until the app closes.
  }
  subs.forEach((f) => f());
}

export function useThanksOn(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => on,
  );
}

/** Thank-yous waiting, shown one at a time. Pure: give it messages and the time. */
export class ThanksQueue {
  private seen = new Set<string>();
  private waiting: ChatMessage[] = [];
  private showing: { comment: ChatComment; until: number } | null = null;
  private primed = false;

  /**
   * What to do now: show a thank-you, take one off, or nothing.
   * Messages already there the first time are not thanked again.
   */
  step(messages: readonly ChatMessage[], now: number, enabled: boolean): { show: ChatComment | null } | null {
    for (const m of messages) {
      if (!m.badge || this.seen.has(m.id)) continue;
      this.seen.add(m.id);
      if (this.primed && enabled) this.waiting.push(m);
    }
    this.primed = true;
    if (this.showing && now < this.showing.until) return null;
    if (this.showing) {
      this.showing = null;
      if (!this.waiting.length) return { show: null };
    }
    const next = enabled ? this.waiting.shift() : undefined;
    if (!next) return null;
    const comment: ChatComment = { author: next.author, text: thanksText(next), platform: next.platform };
    this.showing = { comment, until: now + THANKS_MS };
    return { show: comment };
  }
}

/** In the control window: put thank-yous on the first chat comments card, when turned on. */
export function useChatThanks(show: Show, act: (a: Action) => void): void {
  const enabled = useThanksOn();
  const card = show.sources.find((s) => s.kind.type === 'comment')?.id ?? null;
  const queue = useRef(new ThanksQueue());
  const actRef = useRef(act);
  actRef.current = act;
  const showRef = useRef(show);
  showRef.current = show;
  const last = useRef<ChatComment | null>(null);
  useEffect(() => {
    if (!card) return;
    const tick = () => {
      const r = queue.current.step(chat.state.messages, Date.now(), thanksOn());
      if (!r) return;
      if (r.show) {
        last.current = r.show;
        actRef.current({ type: 'showComment', id: card, comment: r.show });
        return;
      }
      // Taken off only if the card still shows the thank-you (not a comment chosen since).
      const k = showRef.current.sources.find((s) => s.id === card)?.kind;
      const now = k?.type === 'comment' ? k.comment : null;
      if (now && last.current && now.author === last.current.author && now.text === last.current.text) actRef.current({ type: 'showComment', id: card });
      last.current = null;
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [card, enabled]);
}
