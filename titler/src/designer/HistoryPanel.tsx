// The History tab: every step that can be undone (click one to go back to
// it, or forward again), and the title's versions (snapshots kept on this
// computer) to save and restore.

import { useCallback, useEffect, useState } from 'react';
import { History as HistoryIcon, RotateCcw, Trash2 } from 'lucide-react';
import { listVersions, readVersion, removeVersion, saveVersion, type Version, type VersionStore } from './versions';
import { Section } from './fields';
import type { Store } from './store';
import { useStore } from './store';

const when = (at: number) => {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

export function HistoryPanel({ store, versions }: { store: Store; versions?: VersionStore }) {
  // Re-read on every change (the history grows with each edit).
  useStore(store, (s) => s.project);
  const id = useStore(store, (s) => s.project.id);
  const { labels, done } = store.history();
  const [list, setList] = useState<Version[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => void listVersions(id, versions).then(setList), [id, versions]);
  useEffect(reload, [reload]);

  const save = async () => {
    setBusy(true);
    try {
      await saveVersion(store.get().project, name || `Version ${list.length + 1}`, versions);
      setName('');
      store.set({ status: 'Version kept' });
      reload();
    } finally {
      setBusy(false);
    }
  };
  const restore = async (v: Version) => {
    const p = await readVersion(v.id, versions);
    if (!p) return store.set({ status: 'That version could not be read.' });
    store.edit(`Restore “${v.name}”`, () => ({ ...p, id: store.get().project.id }));
    store.set({ status: `Restored “${v.name}” (undo brings back what was there)` });
  };

  return (
    <div className="tt-side-list tt-history" data-testid="titler-history">
      <Section title="Undo history">
        <ol className="tt-steps" aria-label="Undo history">
          <li>
            <button className={done === 0 ? 'on' : ''} onClick={() => store.goTo(0)} aria-current={done === 0 ? 'step' : undefined}>
              Opened
            </button>
          </li>
          {labels.map((l, i) => (
            <li key={i} className={i < done ? '' : 'undone'}>
              <button className={i + 1 === done ? 'on' : ''} onClick={() => store.goTo(i + 1)} aria-current={i + 1 === done ? 'step' : undefined}>
                {l}
              </button>
            </li>
          ))}
        </ol>
        {!labels.length && <div className="tt-dim tt-small tt-pad">Changes appear here; click one to go back to it.</div>}
      </Section>
      <Section title="Versions">
        <div className="tt-version-new">
          <input
            className="tt-input"
            value={name}
            placeholder="Name this version"
            aria-label="Version name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
          />
          <button className="tt-btn" disabled={busy} onClick={() => void save()}>
            <HistoryIcon size={13} /> Keep
          </button>
        </div>
        <ul className="tt-versions" aria-label="Versions">
          {list.map((v) => (
            <li key={v.id}>
              <span className="tt-version-name" title={`${v.name} · ${Math.max(1, Math.round(v.size / 1024))} KB`}>
                {v.name}
              </span>
              <span className="tt-dim">{when(v.at)}</span>
              <button className="tt-ico" aria-label={`Restore ${v.name}`} title="Restore this version" onClick={() => void restore(v)}>
                <RotateCcw size={13} />
              </button>
              <button
                className="tt-ico"
                aria-label={`Remove ${v.name}`}
                title="Remove this version"
                onClick={() => void removeVersion(v.id, versions).then(reload)}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
        {!list.length && <div className="tt-dim tt-small tt-pad">Keep a version before trying something big; it stays on this computer.</div>}
      </Section>
    </div>
  );
}
