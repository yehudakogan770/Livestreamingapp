import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { audienceAddress } from './JoinSetup';
import type { Show } from '../engine/types/Show';
import { chat, thanksText, useChat, type ChatMessage } from '../engine/chat';
import { setThanksOn, useThanksOn } from '../engine/chatThanks';
import type { Act } from './act';
import type { NewSource } from '../engine/types/NewSource';
import type { EngineClient, RemoteStatus } from '../engine/client';
import './ChatPanel.css';

const KEY_STORE = 'lumora.youtubeKey';
const PLATFORM_SHORT = { youtube: 'YT', twitch: 'TW', facebook: 'FB', other: '' } as const;
const readKey = () => {
  try {
    return localStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
};

/**
 * The live chat, beside the controls (it doesn't block them). Connect to
 * Twitch, YouTube or Facebook, then "Show" puts a comment on screen through a chat
 * comments input — put that input on air or on an overlay.
 */
export function ChatPanel({
  show,
  act,
  onAdd,
  onClose,
  client,
}: {
  show: Show;
  act: Act;
  onAdd: (s: NewSource) => void;
  onClose: () => void;
  client: EngineClient;
}) {
  const st = useChat();
  const [tab, setTab] = useState<'chat' | 'questions'>('chat');
  const [remote, setRemote] = useState<RemoteStatus | null>(null);
  useEffect(() => client.watchRemote(setRemote), [client]);
  const [twitch, setTwitch] = useState(st.twitch.channel);
  const [video, setVideo] = useState(st.youtube.video);
  const [key, setKey] = useState(readKey);
  const [find, setFind] = useState('');
  const inputs = show.sources.filter((s) => s.kind.type === 'comment');
  const [target, setTarget] = useState<string>(inputs[0]?.id ?? '');
  const card = show.sources.find((s) => s.id === (target || inputs[0]?.id));
  const shown = card?.kind.type === 'comment' ? card.kind.comment : null;
  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const l = list.current;
    if (l && stick.current) l.scrollTop = l.scrollHeight;
  }, [st.messages]);

  const saveKey = (k: string) => {
    setKey(k);
    try {
      localStorage.setItem(KEY_STORE, k);
    } catch {
      // Kept until the app closes.
    }
  };
  const showIt = (m: ChatMessage) => {
    if (!card) return;
    act({ type: 'showComment', id: card.id, comment: { author: m.author, text: m.badge ? thanksText(m) : m.text, platform: m.platform } });
  };
  const thanks = useThanksOn();
  const q = find.trim().toLowerCase();
  const messages = q ? st.messages.filter((m) => m.text.toLowerCase().includes(q) || m.author.toLowerCase().includes(q)) : st.messages;
  const dot = (s: string) => <span className={`chat__dot chat__dot--${s}`} />;

  return (
    <aside className="chat" aria-label="Live chat">
      <header className="chat__head">
        <div className="chat__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'chat'} className="seg" onClick={() => setTab('chat')}>
            Live chat
          </button>
          <button type="button" role="tab" aria-selected={tab === 'questions'} className="seg" onClick={() => setTab('questions')}>
            Questions{show.qna?.questions.filter((q) => !q.shown).length ? ` (${show.qna.questions.filter((q) => !q.shown).length})` : ''}
          </button>
        </div>
        <button type="button" className="icon" aria-label="Close the chat (it stays connected)" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      {tab === 'questions' ? (
        <Questions show={show} act={act} card={card?.id ?? null} remote={remote} onRemote={() => void client.setRemote(true)} />
      ) : (
        <>
          <div className="chat__connect">
            <div className="chat__row">
              {dot(st.twitch.status)}
              <input className="text" placeholder="Twitch channel" value={twitch} onChange={(e) => setTwitch(e.target.value)} aria-label="Twitch channel" />
              {st.twitch.status === 'off' || st.twitch.status === 'error' ? (
                <button type="button" className="btn btn--small" disabled={!twitch.trim()} onClick={() => chat.connectTwitch(twitch)}>
                  Connect
                </button>
              ) : (
                <button type="button" className="btn btn--small" onClick={() => chat.disconnectTwitch()}>
                  Stop
                </button>
              )}
            </div>
            {st.twitch.problem && <p className="field__note field__note--warn">{st.twitch.problem}</p>}
            <div className="chat__row">
              {dot(st.youtube.status)}
              <input
                className="text"
                placeholder="YouTube live video address"
                value={video}
                onChange={(e) => setVideo(e.target.value)}
                aria-label="YouTube video"
              />
              {st.youtube.status === 'off' || st.youtube.status === 'error' ? (
                <button type="button" className="btn btn--small" disabled={!video.trim()} onClick={() => chat.connectYoutube(video, key)}>
                  Connect
                </button>
              ) : (
                <button type="button" className="btn btn--small" onClick={() => chat.disconnectYoutube()}>
                  Stop
                </button>
              )}
            </div>
            {st.youtube.problem && <p className="field__note field__note--warn">{st.youtube.problem}</p>}
            <div className="chat__row">
              {dot(st.facebook.status)}
              <span className="chat__label">Facebook (the connected account’s live video)</span>
              {st.facebook.status === 'off' || st.facebook.status === 'error' ? (
                <button type="button" className="btn btn--small" onClick={() => chat.connectFacebook()}>
                  Connect
                </button>
              ) : (
                <button type="button" className="btn btn--small" onClick={() => chat.disconnectFacebook()}>
                  Stop
                </button>
              )}
            </div>
            {st.facebook.problem && <p className="field__note field__note--warn">{st.facebook.problem}</p>}
            <details className="chat__key">
              <summary>YouTube API key{key ? ' ✓' : ''}</summary>
              <input className="text" type="password" value={key} onChange={(e) => saveKey(e.target.value)} aria-label="YouTube API key" spellCheck={false} />
              <p className="field__note">
                Free, once: console.cloud.google.com → new project → turn on “YouTube Data API v3” → Credentials → Create API key. Kept on this computer only.
              </p>
            </details>
          </div>
          <div className="chat__target">
            {inputs.length ? (
              <>
                <select value={card?.id ?? ''} onChange={(e) => setTarget(e.target.value)} aria-label="Shown on">
                  {inputs.map((s) => (
                    <option key={s.id} value={s.id}>
                      Show on: {s.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn--small" disabled={!shown} onClick={() => card && act({ type: 'showComment', id: card.id })}>
                  Take off
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn--small btn--primary"
                onClick={() => onAdd({ name: 'Chat comments', kind: { type: 'comment', comment: null, changedAt: 0, place: 'low', accent: '#2f80ed' } })}
              >
                + Make a chat comments input
              </button>
            )}
          </div>
          <label
            className="check chat__thanks"
            title="Super Chats, new members and subscribers, bits and raids show on the card for 8 seconds, one after another"
          >
            <input type="checkbox" checked={thanks} onChange={(e) => setThanksOn(e.target.checked)} /> Thank supporters on screen by themselves
          </label>
          <input className="text chat__find" placeholder="Find…" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find in the chat" />
          <ol
            ref={list}
            className="chat__list"
            onScroll={(e) => {
              const l = e.currentTarget;
              stick.current = l.scrollHeight - l.scrollTop - l.clientHeight < 40;
            }}
          >
            {messages.length === 0 && (
              <li className="chat__empty">
                {st.twitch.status === 'on' || st.youtube.status === 'on' || st.facebook.status === 'on' ? 'Waiting for comments…' : 'Connect to a chat above.'}
              </li>
            )}
            {messages.map((m) => {
              const on = !!shown && shown.author === m.author && shown.text === m.text;
              return (
                <li key={m.id} className={`chat__msg${on ? ' is-on' : ''}`}>
                  <div className="chat__who" style={{ color: m.color }} dir="auto">
                    {m.author} <small>{PLATFORM_SHORT[m.platform]}</small>
                    {m.badge && <span className="chat__badge">{m.badge}</span>}
                  </div>
                  <div className="chat__text" dir="auto">
                    {m.text}
                  </div>
                  <button type="button" className="btn btn--small chat__show" disabled={!card} onClick={() => showIt(m)}>
                    {on ? 'On screen' : 'Show'}
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </aside>
  );
}

/** Audience questions from phones: show one on screen, or let it go. */
function Questions({ show, act, card, remote, onRemote }: { show: Show; act: Act; card: string | null; remote: RemoteStatus | null; onRemote: () => void }) {
  const qna = show.qna ?? { open: false, questions: [], nextId: 0 };
  const list = useRef<HTMLOListElement>(null);
  return (
    <>
      <div className="chat__row">
        <button type="button" className={`btn btn--small${qna.open ? ' is-on' : ' btn--primary'}`} onClick={() => act({ type: 'qnaOpen', value: !qna.open })}>
          {qna.open ? '■ Stop taking questions' : '▶ Take questions'}
        </button>
        <button type="button" className="btn btn--small" disabled={!qna.questions.length} onClick={() => act({ type: 'qnaRemove' })}>
          Clear all
        </button>
      </div>
      {!audienceAddress(remote) ? (
        <p className="field__note field__note--warn">
          Phones send questions through the phone remote, which is off.{' '}
          <button type="button" className="btn btn--small" onClick={onRemote}>
            Turn it on
          </button>
        </p>
      ) : (
        <p className="field__note">
          People send questions at <b>{audienceAddress(remote)?.voteUrl}</b> (the same page as polls; show its code with a poll input).
        </p>
      )}
      {!card && <p className="field__note field__note--warn">Make a chat comments input (Live chat tab) to show questions on screen.</p>}
      <ol ref={list} className="chat__list">
        {qna.questions.length === 0 && <li className="chat__empty">{qna.open ? 'Waiting for questions…' : 'Press “Take questions” to start.'}</li>}
        {[...qna.questions].reverse().map((q) => (
          <li key={q.id} className={`chat__msg${q.shown ? ' is-shown' : ''}`}>
            <div className="chat__who" dir="auto">
              {q.author || 'No name'} <small>{new Date(q.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
            </div>
            <div className="chat__text" dir="auto">
              {q.text}
            </div>
            <span className="chat__show">
              <button type="button" className="btn btn--small" disabled={!card} onClick={() => card && act({ type: 'qnaShow', question: q.id, id: card })}>
                {q.shown ? 'Again' : 'Show'}
              </button>
              <button type="button" className="icon" aria-label="Let it go" onClick={() => act({ type: 'qnaRemove', question: q.id })}>
                <X aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
