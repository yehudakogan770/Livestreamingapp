// A plan's chat, live: the messages, sending and deleting, and how many came
// in from others since the chat was last open on this device.

import { useCallback, useEffect, useState } from 'react';
import * as api from './api';
import { addMessage, loadSeen, saveSeen, unreadCount, type Message } from './chatModel';
import { rememberPlan, savedPlan } from './offlineCache';
import { db } from './session';
import { unreachable } from './usePlan';

export interface ChatStore {
  messages: Message[];
  loaded: boolean;
  error: string;
  unread: number;
  send: (body: string) => Promise<void>;
  remove: (id: string) => void;
  /** The chat is on screen: everything in it counts as read. */
  markRead: () => void;
}

export function useChat(planId: string, me: { id: string }, open: boolean): ChatStore {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [seen, setSeen] = useState(() => loadSeen(planId));

  useEffect(() => {
    let live = true;
    setMessages([]);
    setLoaded(false);
    setError('');
    setSeen(loadSeen(planId));
    api
      .loadMessages(db(), planId)
      .then((list) => {
        if (!live) return;
        setMessages(list);
        setLoaded(true);
        rememberPlan(planId, { messages: list.slice(-200) });
      })
      .catch((e: unknown) => {
        if (!live) return;
        const copy = unreachable(e) ? savedPlan(planId)?.messages : undefined;
        if (copy) {
          setMessages(copy);
          setLoaded(true);
        } else setError(e instanceof Error ? e.message : String(e));
      });
    const stop = api.watchChat(db(), planId, {
      message: (m) => setMessages((list) => addMessage(list, m)),
      gone: (id) => setMessages((list) => list.filter((m) => m.id !== id)),
    });
    return () => {
      live = false;
      stop();
    };
  }, [planId]);

  const markRead = useCallback(() => {
    const last = messages.at(-1)?.createdAt ?? 0;
    setSeen((s) => {
      const next = Math.max(s, last);
      if (next !== s) saveSeen(planId, next);
      return next;
    });
  }, [messages, planId]);

  // While the chat is open, new messages are read as they come.
  useEffect(() => {
    if (open) markRead();
  }, [open, markRead]);

  const send = useCallback(
    async (body: string) => {
      const m = await api.sendMessage(db(), planId, body, me.id);
      setMessages((list) => addMessage(list, m));
    },
    [planId, me.id],
  );

  const remove = useCallback((id: string) => {
    setMessages((list) => list.filter((m) => m.id !== id));
    api.deleteMessage(db(), id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return { messages, loaded, error, unread: open ? 0 : unreadCount(messages, me.id, seen), send, remove, markRead };
}
