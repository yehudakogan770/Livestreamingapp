import { Lock, MessageSquare, MessageSquarePlus, PenLine, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useDoc, type Doc } from '../doc';
import { timecode } from '../model/build';
import { current, rate } from '../model/seq';
import type { Engine } from '../player/engine';
import { Modal } from '../ui/controls';
import { usePlayhead } from '../ui/hooks';
import { checkText, forSequence, MAX_COMMENT, openCount, type ReviewComment } from './comments';
import { canEdit } from './lock';
import { useCollab, type Collab } from './session';

const say = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Who else has the project open (in the top bar). */
export function HereChips({ collab, doc }: { collab: Collab; doc: Doc }) {
  const cs = useCollab(collab);
  const { project } = useDoc(doc);
  if (!cs) return null;
  const seqName = (id: string) => project.sequences.find((s) => s.id === id)?.name ?? 'another sequence';
  return (
    <div className="here" aria-label="People in this project">
      <span className={`here__dot${cs.online ? '' : ' is-off'}`} title={cs.online ? 'Online' : 'Not connected'} />
      {cs.here.length === 0 && <span className="here__alone">{cs.online ? 'Only you here' : 'Offline'}</span>}
      {cs.here.map((h) => (
        <span key={h.id} className={`here__chip${h.editing ? ' is-editing' : ''}`} title={`${h.name}: ${h.editing ? 'editing' : 'watching'} ${seqName(h.seq)}`}>
          {initials(h.name)}
        </span>
      ))}
    </div>
  );
}

const initials = (name: string): string =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

/** Under the top bar: who is editing this sequence, requests to edit it, and saving trouble. */
export function LockBanner({ collab, doc }: { collab: Collab; doc: Doc }) {
  const cs = useCollab(collab);
  const { project } = useDoc(doc);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  if (!cs) return null;
  const s = current(project);
  const v = collab.view(s.id);
  const act = (f: () => Promise<void>) => {
    setBusy(true);
    setProblem('');
    void f()
      .catch((e: unknown) => setProblem(say(e)))
      .finally(() => setBusy(false));
  };
  let body: React.ReactNode = null;
  if (!canEdit(cs.role)) body = <>You are a viewer on this project: you can watch it and leave comments, but not change it.</>;
  else if (!cs.online) body = <>Lumora Studio cannot reach the internet. Editing this shared project is paused until it is back.</>;
  else if (v.kind === 'theirs')
    body = (
      <>
        <b>{v.name}</b> is editing this sequence. You can watch it (read only).{' '}
        {v.askedByMe ? (
          <span className="lockbar__wait">Asked {v.name} to let you edit it…</span>
        ) : (
          <button type="button" className="linkbtn" disabled={busy} onClick={() => act(() => collab.ask())}>
            Ask to edit it
          </button>
        )}
      </>
    );
  else if (v.kind === 'mine' && v.askedBy && cs.ignored !== v.askedBy)
    body = (
      <>
        <b>{v.askedBy}</b> asks to edit this sequence.{' '}
        <button type="button" className="linkbtn" disabled={busy} onClick={() => act(() => collab.handOver())}>
          Hand it over
        </button>{' '}
        ·{' '}
        <button type="button" className="linkbtn" onClick={() => collab.ignore(v.askedBy ?? '')}>
          Keep editing
        </button>
      </>
    );
  if (!body && !problem) return null;
  return (
    <div className={`lockbar${v.kind === 'mine' ? ' is-mine' : ''}`} role="status">
      {v.kind === 'mine' ? <PenLine /> : <Lock />}
      {body}
      {problem && <span className="lockbar__problem">{problem}</span>}
    </div>
  );
}

/** Someone else saved changes to the same thing: reload theirs, or keep mine as a copy. */
export function ConflictDialog({ collab, onOpenShared }: { collab: Collab; onOpenShared: (id: string) => void }) {
  const cs = useCollab(collab);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  if (!cs?.conflict) return null;
  const c = cs.conflict;
  return (
    <Modal title="Someone else changed the same thing" onClose={() => {}}>
      <div className="form">
        <p className="collab__lead">
          While you were working, version {c.theirs.version} was saved by someone else, and it changes the same {c.conflicts.length === 1 ? 'thing' : 'things'}{' '}
          you changed:
        </p>
        <ul className="collab__list">
          {c.conflicts.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <p className="collab__lead">Your changes are not saved yet. Choose what to keep:</p>
        {problem && <p className="form__problem">{problem}</p>}
        <div className="form__foot">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setProblem('');
              collab
                .saveMineAsCopy()
                .then(onOpenShared)
                .catch((e: unknown) => setProblem(say(e)))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? 'Saving…' : 'Save mine as a copy'}
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => collab.reloadTheirs()}>
            Load their version
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Review comments on the open sequence: add one at the playhead, jump to one, mark it done. */
export function CommentsPanel({ collab, doc, engine }: { collab: Collab; doc: Doc; engine: Engine }) {
  const cs = useCollab(collab);
  const { project } = useDoc(doc);
  const t = usePlayhead(engine);
  const [text, setText] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const focus = cs?.focus ?? null;
  useEffect(() => {
    if (focus) listRef.current?.querySelector(`[data-id="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focus]);
  if (!cs) return null;
  const s = current(project);
  const fps = rate(s);
  const list = forSequence(cs.comments, s.id, showDone || cs.comments.some((c) => c.id === focus && c.resolved));
  const add = () => {
    const bad = checkText(text);
    if (bad) return setProblem(bad);
    setBusy(true);
    setProblem('');
    collab
      .addComment(s.id, t, text)
      .then(() => setText(''))
      .catch((e: unknown) => setProblem(say(e)))
      .finally(() => setBusy(false));
  };
  const run = (f: Promise<void>) => void f.catch((e: unknown) => setProblem(say(e)));
  return (
    <div className="comments">
      <form
        className="comments__new"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <textarea
          className="text comments__text"
          placeholder={`Comment at ${timecode(t, fps)}…`}
          value={text}
          maxLength={MAX_COMMENT}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add();
          }}
        />
        <div className="comments__row">
          <label className="comments__done">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done
          </label>
          <span className="comments__count">{openCount(cs.comments, s.id)} open</span>
          <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !text.trim()}>
            <MessageSquarePlus />
            Add at {timecode(t, fps)}
          </button>
        </div>
        {problem && <p className="form__problem">{problem}</p>}
      </form>
      {list.length === 0 && <p className="comments__empty">No {showDone ? '' : 'open '}comments on this sequence. Add one at the playhead above.</p>}
      <ul className="comments__list" ref={listRef}>
        {list.map((c) => (
          <CommentItem
            key={c.id}
            c={c}
            fps={fps}
            mine={c.author === collab.me.id}
            owner={cs.role === 'owner'}
            focused={c.id === focus}
            onGo={() => {
              engine.seek(c.frame);
              collab.focus(c.id);
            }}
            onResolve={(r) => run(collab.resolve(c, r))}
            onDelete={() => run(collab.remove(c))}
          />
        ))}
      </ul>
    </div>
  );
}

function CommentItem({
  c,
  fps,
  mine,
  owner,
  focused,
  onGo,
  onResolve,
  onDelete,
}: {
  c: ReviewComment;
  fps: number;
  mine: boolean;
  owner: boolean;
  focused: boolean;
  onGo: () => void;
  onResolve: (resolved: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <li data-id={c.id} className={`comment${c.resolved ? ' is-done' : ''}${focused ? ' is-focus' : ''}`}>
      <button type="button" className="comment__go" onClick={onGo} title="Go to this frame">
        <MessageSquare className="comment__icon" />
        <span className="comment__time">{timecode(c.frame, fps)}</span>
        <span className="comment__who">{c.authorName}</span>
        <span className="comment__when">{new Date(c.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
      </button>
      <p className="comment__text">{c.text}</p>
      <div className="comment__acts">
        <label>
          <input type="checkbox" checked={c.resolved} onChange={(e) => onResolve(e.target.checked)} /> Done
        </label>
        {(mine || owner) && (
          <button type="button" className="linkbtn comment__del" onClick={onDelete}>
            <Trash2 />
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
