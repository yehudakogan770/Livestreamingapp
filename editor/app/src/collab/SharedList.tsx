import { Cloud, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { authOn } from '../../../../app/src/auth/config';
import { useAccess } from '../../../../app/src/auth/Gate';
import { listShared, type SharedSummary } from './cloud';

/** On the Start screen: projects that are online for you (yours and others'). */
export function SharedList({ onOpen }: { onOpen: (id: string) => void }) {
  const { access } = useAccess();
  const [list, setList] = useState<SharedSummary[] | null>(null);
  const [problem, setProblem] = useState('');
  const signedIn = authOn() && !!access;
  useEffect(() => {
    if (!signedIn) return;
    let gone = false;
    listShared().then(
      (l) => !gone && setList(l),
      (e: unknown) => !gone && setProblem(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      gone = true;
    };
  }, [signedIn]);
  if (!signedIn) return null;
  return (
    <>
      <h2 className="start__h2">
        <Users />
        Shared with me
      </h2>
      {problem && <p className="start__empty">{problem}</p>}
      {!problem && list === null && <p className="start__empty">Looking…</p>}
      {list?.length === 0 && <p className="start__empty">Projects shared with you (and ones you share) show up here.</p>}
      <ul>
        {list?.map((p) => (
          <li key={p.id}>
            <button type="button" className="start__item" onClick={() => onOpen(p.id)} title={`Version ${p.version}`}>
              <Cloud className="start__kind" aria-label="A shared project" />
              <span className="start__name">{p.name}</span>
              <span className="start__when">{new Date(p.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              <span className="start__where">
                {p.role === 'owner' ? 'Yours' : `${p.ownerName || 'Someone'}'s`} · {p.role === 'owner' ? 'shared' : p.role}
                {p.updatedBy ? ` · last saved by ${p.updatedBy}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
