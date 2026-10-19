// The plan's chat: everyone on the plan, live, as a messaging thread. Your
// messages on the right, everyone else's on the left with their initials;
// messages close together from one person form one run. Enter sends
// (Shift+Enter is a new line); "#4" in a message links to cue 4 and "@" names
// someone on the plan.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { MAX_MESSAGE, fullTime, mayDelete, newFromOthers, parseMentions, threadRows, timeLabel, type RunPos } from './chatModel';
import { initials } from './model';
import type { ChatStore } from './useChat';
import type { Message } from './chatModel';
import { Mark } from './Mark';
import { usePlannerFeatures } from './features';
import { MentionBox, WithMentions } from './MentionBox';
import { mentionsIn, type Mentionable } from './mentions';

/** Closer than this to the end of the thread counts as reading the newest messages. */
const NEAR_END = 48;
/** Further than this from the end shows the button back to the newest message. */
const FAR_FROM_END = 240;
/** The message box grows with what is typed, up to this height (then it scrolls). */
const MAX_COMPOSE = 160;

export function Chat({
  chat,
  me,
  isOwner,
  cueCount,
  onCue,
  planName,
  people = [],
}: {
  /** Everyone on the plan, for @mentions (none: no mentions). */
  people?: Mentionable[];
  chat: ChatStore;
  me: string;
  isOwner: boolean;
  cueCount: number;
  onCue: (n: number) => void;
  planName: string;
}) {
  const { messages, loaded, error } = chat;
  const { chat: chatOn } = usePlannerFeatures();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  /** Following the newest message (at the end of the thread). */
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  /** How many messages had been seen at the end of the thread (for the "new messages" button). */
  const [seen, setSeen] = useState(0);
  // The same functions every time, so typing a message does not redraw every message above it.
  const live = useRef({ onCue, remove: chat.remove });
  live.current = { onCue, remove: chat.remove };
  const act = useMemo<MessageActions>(
    () => ({
      cue: (n) => live.current.onCue(n),
      remove: (id) => live.current.remove(id),
      pick: (id) => setPicked((p) => (p === id ? null : id)),
    }),
    [],
  );
  const named = useMemo(() => people, [people]);
  const rows = useMemo(() => threadRows(messages, me), [messages, me]);

  const toEnd = useCallback(
    (smooth = false) => {
      const el = list.current;
      if (!el) return;
      stick.current = true;
      if (smooth && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      else el.scrollTop = el.scrollHeight;
      setAway(false);
      setSeen(messages.length);
    },
    [messages.length],
  );

  // Stay at the newest message unless scrolled up to read older ones.
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) {
      el.scrollTop = el.scrollHeight;
      setSeen(messages.length);
    }
  }, [messages.length]);
  // The thread gets shorter (the message box grows, the keyboard opens): the newest message stays in view.
  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    chat.markRead();
  }, [messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // The message box grows with its text (field-sizing where the browser has it, and here for the rest).
  useLayoutEffect(() => {
    const ta = field.current?.querySelector('textarea');
    if (!ta) return;
    ta.style.height = 'auto';
    if (ta.scrollHeight) ta.style.height = `${Math.min(ta.scrollHeight, MAX_COMPOSE)}px`;
  }, [text]);

  const send = () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr('');
    stick.current = true;
    chat
      .send(body, named.length ? mentionsIn(body, named, me) : [])
      .then(() => setText(''))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const unseen = stick.current ? 0 : newFromOthers(messages, seen, me);

  return (
    <section className="chat" aria-label="Chat">
      <div className="chat__body">
        <div
          className="chat__scroll"
          ref={list}
          role="log"
          aria-live="polite"
          onScroll={(e) => {
            const el = e.currentTarget;
            const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
            stick.current = gap < NEAR_END;
            if (stick.current) setSeen(messages.length);
            setAway(gap > FAR_FROM_END);
          }}
        >
          <div className="chat__thread">
            {error && <p className="warn chat__note">{error}</p>}
            {!error && !loaded && <p className="muted chat__note">Loading messages…</p>}
            {loaded && messages.length === 0 && (
              <div className="chat__empty">
                <Mark size={28} />
                <p>No messages yet.</p>
                <p className="muted small">
                  Everyone on “{planName || 'this plan'}” can read and write here. Write #4 to point at cue 4
                  {named.length ? ', or @ and a name to let someone know.' : '.'}
                </p>
              </div>
            )}
            {rows.map((r) =>
              r.kind === 'day' ? (
                <div key={r.key} className="chat__day" role="separator">
                  <span>{r.label}</span>
                </div>
              ) : (
                <MessageItem
                  key={r.key}
                  m={r.m}
                  mine={r.mine}
                  pos={r.pos}
                  head={r.head}
                  time={r.time}
                  picked={picked === r.m.id}
                  canDelete={mayDelete(r.m, me, isOwner)}
                  cueCount={cueCount}
                  act={act}
                  people={named}
                />
              ),
            )}
          </div>
        </div>
        {(away || unseen > 0) && (
          <button type="button" className={`chat__jump${unseen > 0 ? ' is-new' : ''}`} onClick={() => toEnd(true)}>
            <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
            {unseen > 0 ? `${unseen} new message${unseen === 1 ? '' : 's'}` : 'Latest'}
          </button>
        )}
      </div>
      {!chatOn ? (
        <p className="chat__compose chat__off muted small" role="status">
          The Lumora team has turned off Planner chat for now. You can still read the messages.
        </p>
      ) : (
        <form
          className="chat__compose"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {err && <p className="warn small chat__err">{err}</p>}
          <div className="chat__field" ref={field}>
            {named.length ? (
              <MentionBox
                className="chat__input"
                rows={1}
                maxLength={MAX_MESSAGE}
                value={text}
                people={named}
                me={me}
                placeholder="Message"
                label="Message"
                onChange={setText}
                onKeyDown={keys}
              />
            ) : (
              <textarea
                className="chat__input"
                rows={1}
                maxLength={MAX_MESSAGE}
                value={text}
                placeholder="Message"
                aria-label="Message"
                enterKeyHint="send"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={keys}
              />
            )}
            <button type="submit" className="chat__send" disabled={busy || !text.trim()} aria-label="Send" title="Send (Enter)">
              <ArrowUp size={16} strokeWidth={2.25} aria-hidden="true" />
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

interface MessageActions {
  cue: (n: number) => void;
  remove: (id: string) => void;
  /** Tap a message: its time (and Delete) show, or hide again. */
  pick: (id: string) => void;
}

/** One message: a bubble in its run, with the name and initials at the start of someone else's run. */
const MessageItem = memo(function MessageItem({
  m,
  mine,
  pos,
  head,
  time,
  picked,
  canDelete,
  cueCount,
  act,
  people,
}: {
  people: Mentionable[];
  m: Message;
  mine: boolean;
  pos: RunPos;
  head: boolean;
  time: boolean;
  picked: boolean;
  canDelete: boolean;
  cueCount: number;
  act: MessageActions;
}) {
  const who = m.authorName || 'Someone';
  return (
    <article
      className={`bub bub--${mine ? 'mine' : 'theirs'} bub--${pos}${picked ? ' is-picked' : ''}`}
      aria-label={`${mine ? 'You' : who}, ${timeLabel(m.createdAt)}`}
    >
      {!mine && (
        <span className={`bub__avatar${head ? ' avatar' : ''}`} aria-hidden="true">
          {head ? initials(who) : ''}
        </span>
      )}
      <div className="bub__col">
        {head && <div className="bub__name">{who}</div>}
        <div className="bub__line">
          <div
            className="bub__bubble"
            title={fullTime(m.createdAt)}
            onClick={(e) => {
              // A cue link or a selection of text is not a tap on the message.
              if ((e.target as HTMLElement).closest('button')) return;
              if (window.getSelection?.()?.toString()) return;
              act.pick(m.id);
            }}
          >
            <p className="bub__body">
              {parseMentions(m.body, cueCount).map((p, k) =>
                'cue' in p ? (
                  <button key={k} type="button" className="bub__cue" onClick={() => act.cue(p.cue)} title={`Show cue ${p.cue}`}>
                    {p.text}
                  </button>
                ) : (
                  <span key={k}>
                    <WithMentions text={p.text} people={people} />
                  </span>
                ),
              )}
            </p>
          </div>
          {canDelete && (
            <button
              type="button"
              className="bub__del"
              aria-label="Delete message"
              title="Delete message"
              onClick={() => confirm('Delete this message for everyone?') && act.remove(m.id)}
            >
              <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </div>
        {(time || picked) && (
          <time className="bub__time" dateTime={new Date(m.createdAt).toISOString()}>
            {timeLabel(m.createdAt)}
          </time>
        )}
      </div>
    </article>
  );
});
