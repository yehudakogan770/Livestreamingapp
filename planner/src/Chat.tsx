// The plan's chat: everyone on the plan, live. Enter sends (Shift+Enter is a
// new line); "#4" in a message links to cue 4.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Trash2 } from 'lucide-react';
import { MAX_MESSAGE, dayLabel, mayDelete, parseMentions, startsDay, startsGroup, timeLabel } from './chatModel';
import { initials } from './Inspector';
import type { ChatStore } from './useChat';
import type { Message } from './chatModel';
import { Mark } from './Mark';
import { usePlannerFeatures } from './features';

export function Chat({
  chat,
  me,
  isOwner,
  cueCount,
  onCue,
  planName,
}: {
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
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // The same functions every time, so typing a message does not redraw every message above it.
  const live = useRef({ onCue, remove: chat.remove });
  live.current = { onCue, remove: chat.remove };
  const act = useMemo<MessageActions>(() => ({ cue: (n) => live.current.onCue(n), remove: (id) => live.current.remove(id) }), []);

  // Stay at the newest message unless scrolled up to read older ones.
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);
  useEffect(() => {
    chat.markRead();
  }, [messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr('');
    stick.current = true;
    chat
      .send(body)
      .then(() => setText(''))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="chat" aria-label="Chat">
      <div
        className="chat__list"
        ref={list}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {error && <p className="warn chat__note">{error}</p>}
        {!error && !loaded && <p className="muted chat__note">Loading the chat…</p>}
        {loaded && messages.length === 0 && (
          <div className="chat__empty">
            <Mark size={28} />
            <p>No messages yet.</p>
            <p className="muted small">A chat for everyone on “{planName || 'this plan'}”. Write #4 to point at cue 4.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageItem
            key={m.id}
            m={m}
            day={startsDay(messages, i)}
            head={startsGroup(messages, i)}
            mine={m.author === me}
            canDelete={mayDelete(m, me, isOwner)}
            cueCount={cueCount}
            act={act}
          />
        ))}
      </div>
      {!chatOn ? (
        <p className="chat__compose muted small" role="status">
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
          <div className="chat__row">
            <textarea
              className="input chat__input"
              rows={1}
              maxLength={MAX_MESSAGE}
              value={text}
              placeholder="Message everyone on this plan"
              aria-label="Message"
              enterKeyHint="send"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button type="submit" className="btn btn--primary btn--icon chat__send" disabled={busy || !text.trim()} aria-label="Send">
              <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <p className="chat__tip muted">Enter sends · Shift+Enter for a new line · #4 links to cue 4</p>
        </form>
      )}
    </section>
  );
}

interface MessageActions {
  cue: (n: number) => void;
  remove: (id: string) => void;
}

/** One message (and the day above it, if it starts one). */
const MessageItem = memo(function MessageItem({
  m,
  day,
  head,
  mine,
  canDelete,
  cueCount,
  act,
}: {
  m: Message;
  day: boolean;
  head: boolean;
  mine: boolean;
  canDelete: boolean;
  cueCount: number;
  act: MessageActions;
}) {
  return (
    <div className="chat__item">
      {day && <div className="chat__day">{dayLabel(m.createdAt)}</div>}
      <article className={`msg${head ? ' msg--head' : ''}${mine ? ' msg--mine' : ''}`} aria-label={`${m.authorName || 'Someone'}, ${timeLabel(m.createdAt)}`}>
        {head ? (
          <span className="avatar msg__avatar" aria-hidden="true">
            {initials(m.authorName || '?')}
          </span>
        ) : (
          <span className="msg__gutter mono" aria-hidden="true">
            {timeLabel(m.createdAt).replace(/ [AP]M$/, '')}
          </span>
        )}
        <div className="msg__main">
          {head && (
            <div className="msg__head">
              <b>{m.authorName || 'Someone'}</b>
              <time className="muted small" dateTime={new Date(m.createdAt).toISOString()}>
                {timeLabel(m.createdAt)}
              </time>
            </div>
          )}
          <p className="msg__body">
            {parseMentions(m.body, cueCount).map((p, k) =>
              'cue' in p ? (
                <button key={k} type="button" className="msg__cue" onClick={() => act.cue(p.cue)} title={`Show cue ${p.cue}`}>
                  {p.text}
                </button>
              ) : (
                <span key={k}>{p.text}</span>
              ),
            )}
          </p>
        </div>
        {canDelete && (
          <button
            type="button"
            className="btn btn--quiet btn--icon msg__del"
            aria-label="Delete message"
            title="Delete message"
            onClick={() => confirm('Delete this message for everyone?') && act.remove(m.id)}
          >
            <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </article>
    </div>
  );
});
