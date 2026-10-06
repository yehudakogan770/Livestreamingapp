// Smart bins in the project panel (they fill themselves by rules), and the
// media management commands for a clip's right-click menu.
import { useState, type ReactNode } from 'react';
import type { MediaItem, Project } from '../model/types';
import { useDoc, type Doc } from '../doc';
import { detectShots, setShotsOnImport, shotsOnImport } from '../manage/shots';
import { removeUnused, setMediaInfo, smartBinItems } from '../manage/smartbins';
import { inApp } from '../native';
import type { MenuEntry } from './controls';
import { panels } from './panels';
import type { Ui } from './state';
import './delivery.css';

export function SmartBinsSection({ doc, ui, row, search }: { doc: Doc; ui: Ui; row: (m: MediaItem) => ReactNode; search: (m: MediaItem) => boolean }) {
  const { project } = useDoc(doc);
  const [open, setOpen] = useState<string | null>(null);
  const bins = project.smartBins ?? [];
  return (
    <div className="sbins">
      <div className="sbins__head">
        <span>Smart bins</span>
        <span className="ed__fill" />
        <button type="button" className="tbtn" title="New smart bin" aria-label="New smart bin" onClick={() => panels.show({ kind: 'smartBin', id: null })}>
          +
        </button>
        <button
          type="button"
          className="linkbtn"
          title="Remove the media no sequence uses"
          onClick={() => {
            const { removed } = removeUnused(doc.project);
            if (!removed) return ui.note('Everything in the project is used');
            doc.edit((p) => removeUnused(p).project, `Remove ${removed} unused`);
            ui.note(`Removed ${removed} unused item${removed === 1 ? '' : 's'} (Undo brings them back)`);
          }}
        >
          Remove unused
        </button>
      </div>
      {bins.map((b) => {
        const items = smartBinItems(project, b).filter(search);
        return (
          <div key={b.id}>
            <button
              type="button"
              className={`sbins__bin${open === b.id ? ' is-on' : ''}`}
              aria-expanded={open === b.id}
              onClick={() => setOpen(open === b.id ? null : b.id)}
              onDoubleClick={() => panels.show({ kind: 'smartBin', id: b.id })}
              onContextMenu={(e) => {
                e.preventDefault();
                panels.show({ kind: 'smartBin', id: b.id });
              }}
              title="A smart bin (double-click to change its rules)"
            >
              <span>{open === b.id ? '▾' : '▸'}</span>
              <span className="media__name">⚙ {b.name}</span>
              <span className="media__meta">{items.length}</span>
            </button>
            {open === b.id && <div className="media__items">{items.map(row)}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** Media management entries for a clip's right-click menu. */
export function mediaManageMenu(doc: Doc, ui: Ui, m: MediaItem): MenuEntry[] {
  const rate = (n: number) => doc.edit((p: Project) => setMediaInfo(p, m.id, { rating: n }), 'Rate clip');
  return [
    'sep',
    { label: 'Clip info, tags and notes…', run: () => panels.show({ kind: 'mediaInfo', media: m.id }) },
    {
      label: 'Rating',
      items: [0, 1, 2, 3, 4, 5].map((n) => ({ label: n ? '★'.repeat(n) : 'No rating', checked: (m.rating ?? 0) === n, run: () => rate(n) })),
    },
    { label: 'Find in sequences…', run: () => panels.show({ kind: 'uses', media: m.id }) },
    {
      label: 'Split into shots (scene detection)',
      disabled: m.kind !== 'video' || !inApp(),
      run: () => {
        ui.note(`Looking for shot changes in ${m.name}…`);
        void detectShots(doc, m.id)
          .then((n) => ui.note(n > 1 ? `${n} shots, in the bin “${m.name} · shots”` : 'No shot changes found'))
          .catch((e: unknown) => ui.note(e instanceof Error ? e.message : String(e)));
      },
    },
    { label: 'Split long clips into shots on import', checked: shotsOnImport(), run: () => setShotsOnImport(!shotsOnImport()) },
  ];
}
