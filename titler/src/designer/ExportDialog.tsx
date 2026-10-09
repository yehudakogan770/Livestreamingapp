// Export: the title for Lumora (.lumtitle), as an HTML / OGraf template for
// other playout systems, or as Lottie for apps, sites and other tools.

import { useState } from 'react';
import { fileName } from '../core/package';
import { slug } from '../core/htmlTemplate';
import type { Store } from './store';
import { download, type Host } from './host';
import { EXPORTERS, type ExportKind } from './exporters';

export function ExportDialog({ store, host, onClose, onLumtitle }: { store: Store; host: Host; onClose: () => void; onLumtitle: () => void }) {
  const [kind, setKind] = useState<ExportKind>('template');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const run = async () => {
    if (kind === 'lumtitle') {
      onClose();
      onLumtitle();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const p = store.get().project;
      const out = await EXPORTERS[kind].run(p, host);
      download(`${slug(p.name)}${EXPORTERS[kind].ext}`, out.blob);
      store.set({ status: `Exported ${fileName(p).replace(/\.lumtitle$/, '')} (${EXPORTERS[kind].name})` });
      if (out.notes.length) setNotes(out.notes);
      else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tt-modal" role="dialog" aria-label="Export">
      <div className="tt-modal-box tt-export">
        <h2>Export</h2>
        {notes.length ? (
          <>
            <p>Exported. Some things are drawn differently there:</p>
            <ul className="tt-export-notes">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <div className="tt-modal-actions">
              <button className="tt-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="tt-export-list" role="radiogroup" aria-label="Export as">
              {(Object.keys(EXPORTERS) as ExportKind[]).map((k) => (
                <label key={k} className={`tt-export-item${kind === k ? ' on' : ''}`}>
                  <input type="radio" name="tt-export" checked={kind === k} onChange={() => setKind(k)} />
                  <span>
                    <strong>{EXPORTERS[k].name}</strong>
                    <span className="tt-dim">{EXPORTERS[k].about}</span>
                  </span>
                </label>
              ))}
            </div>
            {error && <div className="tt-error">{error}</div>}
            <div className="tt-modal-actions">
              <button className="tt-plain" onClick={onClose}>
                Cancel
              </button>
              <button className="tt-primary" onClick={() => void run()} disabled={busy}>
                {busy ? 'Exporting…' : 'Export'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
