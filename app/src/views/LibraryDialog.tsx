import { useEffect, useMemo, useState } from 'react';
import type { EngineClient } from '../engine/client';
import type { Show } from '../engine/types/Show';
import { describeItem, useItemActions, type LibraryItem } from '../engine/library';
import type { Act } from './act';
import './LibraryDialog.css';

function useEsc(onClose: () => void) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
}

/** Name it and choose a category, then keep it in the library. */
export function SaveToLibrary({ client, item, onClose }: { client: EngineClient; item: LibraryItem; onClose: (saved: boolean) => void }) {
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category);
  const [categories, setCategories] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  useEsc(() => onClose(false));
  useEffect(() => {
    void client.libraryItems().then((all) => setCategories([...new Set(all.map((i) => i.category).filter(Boolean))].sort()));
  }, [client]);
  const save = async () => {
    try {
      const all = await client.libraryItems();
      await client.saveLibrary([...all, { ...item, name: name.trim() || item.name, category: category.trim() }]);
      onClose(true);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Save to library" onPointerDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="modal__box confirm">
        <header className="modal__head">
          <h2>Save to library</h2>
        </header>
        <div className="lib__save">
          <p className="confirm__text lib__why">Kept on this computer, ready for any later event. ({describeItem(item)})</p>
          <label className="field">
            <span className="field__label">Name</span>
            <input className="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Name in the library" autoFocus />
          </label>
          <label className="field">
            <span className="field__label">Category</span>
            <input
              className="text"
              list="lib-categories"
              value={category}
              maxLength={40}
              placeholder="e.g. Graduation, Lower thirds, Dinners"
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Category"
            />
            <datalist id="lib-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          {problem && (
            <p className="field__note field__note--warn" role="alert">
              {problem}
            </p>
          )}
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void save()}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Everything kept for later events: find it, use it here, export / import. */
export function LibraryDialog({ show, client, act, onClose }: { show: Show; client: EngineClient; act: Act; onClose: () => void }) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  useEsc(onClose);
  useEffect(() => {
    void client.libraryItems().then(setItems, () => setItems([]));
  }, [client]);
  const categories = useMemo(() => [...new Set((items ?? []).map((i) => i.category || 'No category'))].sort(), [items]);
  const shown = (items ?? []).filter(
    (i) =>
      (category === null || (i.category || 'No category') === category) &&
      (!query.trim() || `${i.name} ${i.category} ${describeItem(i)}`.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const store = async (next: LibraryItem[]) => {
    await client.saveLibrary(next);
    setItems(next);
  };
  const use = (it: LibraryItem) => {
    for (const a of useItemActions(it, show)) act(a);
    setNotice(`“${it.name}” was added to this event.`);
  };
  const importFile = async () => {
    try {
      const got = await client.importLibrary();
      if (!got.length) return;
      const have = new Set((items ?? []).map((i) => i.id));
      const fresh = got.filter((i) => !have.has(i.id));
      await store([...(items ?? []), ...fresh]);
      setNotice(`${fresh.length} item${fresh.length === 1 ? '' : 's'} added to the library.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };
  const exportFile = async () => {
    try {
      if (await client.exportLibrary(shown)) setNotice(`${shown.length} item${shown.length === 1 ? '' : 's'} saved to the file.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Library" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box lib">
        <header className="modal__head">
          <h2>Library</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="lib__body">
          <nav className="lib__cats" aria-label="Categories">
            <button type="button" className={`lib__cat${category === null ? ' is-on' : ''}`} onClick={() => setCategory(null)}>
              Everything <em>{items?.length ?? 0}</em>
            </button>
            {categories.map((c) => (
              <button key={c} type="button" className={`lib__cat${category === c ? ' is-on' : ''}`} onClick={() => setCategory(c)}>
                {c} <em>{(items ?? []).filter((i) => (i.category || 'No category') === c).length}</em>
              </button>
            ))}
          </nav>
          <section className="lib__main">
            <div className="lib__tools">
              <input
                className="text lib__search"
                type="search"
                value={query}
                placeholder="Search the library"
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search"
              />
              <button type="button" className="btn" onClick={() => void importFile()}>
                Import…
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void exportFile()}
                disabled={!shown.length}
                title="Save these items to a file, to take to another computer"
              >
                Export{category || query ? ' these' : ''}…
              </button>
            </div>
            {items === null ? (
              <p className="field__note">Opening the library…</p>
            ) : shown.length === 0 ? (
              <p className="field__note lib__empty">
                {items.length === 0
                  ? 'Nothing kept yet. Use “Save to library…” on an input’s ⋯ menu, in a preset, or in the run of show — it will be here for every later event.'
                  : 'Nothing matches.'}
              </p>
            ) : (
              <ul className="lib__list">
                {shown.map((it) => (
                  <li key={it.id} className="lib__item">
                    <span className="lib__what">
                      <b>{it.name}</b>
                      <em>
                        {describeItem(it)}
                        {it.category ? ` · ${it.category}` : ''} · saved {new Date(it.savedAt).toLocaleDateString()}
                      </em>
                    </span>
                    <button type="button" className="btn btn--primary" onClick={() => use(it)}>
                      Use in this event
                    </button>
                    <button
                      type="button"
                      className="icon"
                      aria-label={`Delete ${it.name} from the library`}
                      onClick={() => void store((items ?? []).filter((x) => x.id !== it.id))}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {notice && (
              <p className="field__note" role="status">
                {notice}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
