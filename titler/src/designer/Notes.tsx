// Notes pinned on the canvas (the Note tool, M): numbered tags on the
// composition, written in a small card over the canvas and listed in the
// History tab, marked done when dealt with. They travel with the title and
// are never drawn on air.

import { Check, Trash2, X } from 'lucide-react';
import type { CanvasNote, TitleProject } from '../core/types';
import { Section } from './fields';
import type { Store } from './store';
import { useStore } from './store';

const updNote = (p: TitleProject, id: string, patch: Partial<CanvasNote>): TitleProject => ({
  ...p,
  notes: (p.notes ?? []).map((n) => (n.id === id ? { ...n, ...patch } : n)),
});
const dropNote = (p: TitleProject, id: string): TitleProject => ({ ...p, notes: (p.notes ?? []).filter((n) => n.id !== id) });

/** The note being written, in a card over the canvas. */
export function NotesPopover({ store }: { store: Store }) {
  const id = useStore(store, (s) => s.editingNote ?? null);
  const notes = useStore(store, (s) => s.project.notes);
  const compId = useStore(store, (s) => s.compId);
  const note = notes?.find((n) => n.id === id);
  if (!note) return null;
  const number = (notes ?? []).filter((n) => n.comp === compId).indexOf(note) + 1;
  const close = () => {
    // An empty note that was never written goes away.
    if (!note.text.trim()) store.edit('Remove note', (p) => dropNote(p, note.id), { editingNote: null });
    else store.set({ editingNote: null });
  };
  return (
    <div className="tt-note-card" role="dialog" aria-label={`Note ${number}`}>
      <header>
        <span>Note {number}</span>
        <span className="tt-grow" />
        <button
          className="tt-ico"
          title={note.done ? 'Open it again' : 'Mark as done'}
          aria-label="Done"
          onClick={() => store.edit('Note done', (p) => updNote(p, note.id, { done: !note.done }))}
        >
          <Check size={13} />
        </button>
        <button
          className="tt-ico"
          title="Remove the note"
          aria-label="Remove note"
          onClick={() => store.edit('Remove note', (p) => dropNote(p, note.id), { editingNote: null })}
        >
          <Trash2 size={13} />
        </button>
        <button className="tt-ico" title="Close" aria-label="Close note" onClick={close}>
          <X size={13} />
        </button>
      </header>
      <textarea
        className="tt-textarea"
        autoFocus
        rows={3}
        placeholder="What should change here?"
        aria-label="Note"
        value={note.text}
        onFocus={() => store.begin('Write note')}
        onBlur={() => store.end()}
        onChange={(e) => store.edit('Write note', (p) => updNote(p, note.id, { text: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) close();
        }}
      />
      <div className="tt-dim tt-small">{new Date(note.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
    </div>
  );
}

/** Every note of the composition, to open, mark done or remove. */
export function NotesPanel({ store }: { store: Store }) {
  const notes = useStore(store, (s) => s.project.notes);
  const compId = useStore(store, (s) => s.compId);
  const list = (notes ?? []).filter((n) => n.comp === compId);
  const open = list.filter((n) => !n.done).length;
  return (
    <Section title={list.length ? `Notes (${open} open)` : 'Notes'} open={list.length > 0}>
      {!list.length && <div className="tt-dim tt-small tt-pad">Pin a note on the canvas with the Note tool (M): what to change, and where.</div>}
      <ol className="tt-notes" aria-label="Notes">
        {list.map((n, i) => (
          <li key={n.id} className={n.done ? 'done' : ''}>
            <button className="tt-note-open" onClick={() => store.set({ editingNote: n.id })} title="Open this note">
              <b>{i + 1}</b> {n.text.trim() || <i>Empty note</i>}
            </button>
            <button
              className="tt-ico"
              aria-label={n.done ? `Open note ${i + 1} again` : `Note ${i + 1} done`}
              title={n.done ? 'Open it again' : 'Mark as done'}
              onClick={() => store.edit('Note done', (p) => updNote(p, n.id, { done: !n.done }))}
            >
              <Check size={13} />
            </button>
          </li>
        ))}
      </ol>
    </Section>
  );
}
