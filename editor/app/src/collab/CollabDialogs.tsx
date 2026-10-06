import { useCallback, useEffect, useState } from 'react';
import { authOn } from '../../../../app/src/auth/config';
import type { Doc } from '../doc';
import { Modal } from '../ui/controls';
import * as cloud from './cloud';
import { canEdit } from './lock';
import { useCollab, type Collab } from './session';

const say = (e: unknown) => (e instanceof Error ? e.message : String(e));
const when = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const ROLE_NAMES = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' } as const;

/**
 * Share a project on this computer (it goes online), or, for a shared one,
 * see who is on it and invite people by the email of their Lumora account.
 */
export function ShareDialog({
  doc,
  collab,
  signedIn,
  onClose,
  onShared,
  onLeft,
}: {
  doc: Doc;
  collab: Collab | null;
  signedIn: boolean;
  onClose: () => void;
  /** The project is online now: open it as a shared project. */
  onShared: (id: string) => void;
  /** You left the project, or it was taken offline. */
  onLeft: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const act = (f: () => Promise<unknown>) => {
    setBusy(true);
    setProblem('');
    void f()
      .catch((e: unknown) => setProblem(say(e)))
      .finally(() => setBusy(false));
  };
  if (!collab)
    return (
      <Modal title="Share project" onClose={onClose}>
        <div className="form">
          <p className="collab__lead">
            Put this project online so others whose accounts are set up for Lumora Studio can open it from their Start screen, as editors or viewers. One person
            edits each sequence at a time; everyone can leave comments on the timeline.
          </p>
          <p className="collab__lead">
            Only the edit goes online, not your video, sound or picture files. Each person keeps their own copies, and Lumora Studio asks them to find any it
            can't (by file name). From now on this project saves online; the file on this computer stays as it is now.
          </p>
          {!authOn() && <p className="form__problem">Team projects need the Lumora sign-in, which is not set up in this copy of Lumora Studio.</p>}
          {authOn() && !signedIn && <p className="form__problem">Sign in to share projects.</p>}
          {problem && <p className="form__problem">{problem}</p>}
          <div className="form__foot">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || !signedIn || !authOn()}
              onClick={() => act(async () => onShared(await cloud.shareProject(doc.project)))}
            >
              {busy ? 'Sharing…' : 'Share project'}
            </button>
          </div>
        </div>
      </Modal>
    );
  return <PeopleDialog collab={collab} busy={busy} problem={problem} act={act} onClose={onClose} onLeft={onLeft} />;
}

function PeopleDialog({
  collab,
  busy,
  problem,
  act,
  onClose,
  onLeft,
}: {
  collab: Collab;
  busy: boolean;
  problem: string;
  act: (f: () => Promise<unknown>) => void;
  onClose: () => void;
  onLeft: () => void;
}) {
  const cs = useCollab(collab);
  const [list, setList] = useState<cloud.Person[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [sure, setSure] = useState(false);
  const owner = cs?.role === 'owner';
  const load = useCallback(() => void cloud.people(collab.id).then(setList, () => setList([])), [collab.id]);
  useEffect(load, [load]);
  return (
    <Modal title="People on this project" onClose={onClose} wide>
      <div className="form">
        <ul className="people-list">
          {list === null && <li className="collab__lead">Loading…</li>}
          {list?.map((p) => (
            <li key={p.userId} className="people-list__row">
              <span className="people-list__who">
                <b>
                  {p.name || p.email}
                  {p.userId === collab.me.id ? ' (you)' : ''}
                </b>
                <span>{p.email}</span>
              </span>
              {owner && p.role !== 'owner' ? (
                <select
                  className="text people-list__role"
                  value={p.role}
                  aria-label={`Role of ${p.name || p.email}`}
                  disabled={busy}
                  onChange={(e) => act(() => cloud.setRole(collab.id, p.userId, e.target.value as 'editor' | 'viewer').then(load))}
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              ) : (
                <span className="people-list__tag">{ROLE_NAMES[p.role]}</span>
              )}
              {p.role !== 'owner' && (owner || p.userId === collab.me.id) && (
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await cloud.removePerson(collab.id, p.userId);
                      if (p.userId === collab.me.id) onLeft();
                      else load();
                    })
                  }
                >
                  {p.userId === collab.me.id ? 'Leave' : 'Remove'}
                </button>
              )}
            </li>
          ))}
        </ul>
        {owner && (
          <form
            className="people-list__invite"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await cloud.invite(collab.id, email, role);
                setEmail('');
                load();
              });
            }}
          >
            <input
              className="text"
              type="email"
              placeholder="Email of their Lumora account"
              aria-label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              required
            />
            <select className="text" value={role} aria-label="Role" onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
              <option value="editor">Editor (can change it)</option>
              <option value="viewer">Viewer (watch and comment)</option>
            </select>
            <button type="submit" className="btn btn--primary" disabled={busy || !email.trim()}>
              Invite
            </button>
          </form>
        )}
        <p className="collab__note">
          {owner
            ? 'Only accounts the Lumora team has approved can be invited. They find the project under “Shared with me” on their Start screen.'
            : 'Only the owner can invite people.'}
        </p>
        {problem && <p className="form__problem">{problem}</p>}
        {owner && (
          <div className="form__foot">
            {sure ? (
              <>
                <span className="form__est">This deletes the online project, its history and comments for everyone.</span>
                <button type="button" className="btn" onClick={() => setSure(false)}>
                  Keep it
                </button>
                <button type="button" className="btn btn--danger" disabled={busy} onClick={() => act(() => cloud.deleteShared(collab.id).then(onLeft))}>
                  Delete for everyone
                </button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => setSure(true)}>
                Stop sharing…
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Earlier saved versions; going back to one saves it as the newest version. */
export function HistoryDialog({ collab, onClose }: { collab: Collab; onClose: () => void }) {
  const cs = useCollab(collab);
  const [list, setList] = useState<cloud.VersionInfo[] | null>(null);
  const [problem, setProblem] = useState('');
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const version = cs?.version ?? 0;
  useEffect(() => {
    void cloud.versions(collab.id).then(setList, (e: unknown) => setProblem(say(e)));
  }, [collab.id, version]);
  const may = !!cs && canEdit(cs.role);
  const restore = (v: cloud.VersionInfo) => {
    setBusy(true);
    setProblem('');
    void cloud
      .versionDoc(v.id)
      .then((old) => collab.restore(v.version, old))
      .then(() => {
        setAsking(null);
        onClose();
      })
      .catch((e: unknown) => setProblem(say(e)))
      .finally(() => setBusy(false));
  };
  return (
    <Modal title="Version history" onClose={onClose} wide>
      <div className="form">
        <p className="collab__lead">
          Saves close together by one person are kept as one version. Going back to an earlier version saves it as the newest one, so nothing is lost.
        </p>
        {problem && <p className="form__problem">{problem}</p>}
        {list === null && !problem && <p className="collab__lead">Loading…</p>}
        <ul className="versions">
          {list?.map((v) => (
            <li key={v.id} className="versions__row">
              <span className="versions__num">v{v.version}</span>
              <span className="versions__who">
                <b>{v.savedByName || 'Someone'}</b>
                <span>
                  {when(v.savedAt)}
                  {v.note ? ` · ${v.note}` : ''}
                </span>
              </span>
              {v.version === version ? (
                <span className="people-list__tag">Now</span>
              ) : !may ? null : asking === v.id ? (
                <span className="versions__ask">
                  Go back to v{v.version}?{' '}
                  <button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={() => restore(v)}>
                    {busy ? 'Restoring…' : 'Yes'}
                  </button>{' '}
                  <button type="button" className="btn btn--sm" onClick={() => setAsking(null)}>
                    No
                  </button>
                </span>
              ) : (
                <button type="button" className="btn btn--sm" onClick={() => setAsking(v.id)}>
                  Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
