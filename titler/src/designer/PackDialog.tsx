// Share titles as a template pack (.lumpack): pick titles from the library,
// say what the pack is, save it. Packs open with Import, on any computer.

import { useEffect, useState } from 'react';
import type { BrowserEnv } from '../core/browserEnv';
import { renderFrame } from '../core/render';
import { PACK_EXTENSION, writePack } from '../core/titlePack';
import { slug } from '../core/htmlTemplate';
import type { TitleProject } from '../core/types';
import { download, type Host, type LibraryEntry } from './host';
import { selfContained } from './exporting';

/** A small picture of a title at its hold, as PNG bytes. */
async function thumbnail(p: TitleProject, env: BrowserEnv): Promise<Uint8Array | null> {
  try {
    await env.prepare(p);
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 270;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const comp = p.compositions.find((x) => x.id === p.main) ?? p.compositions[0];
    ctx.fillStyle = '#3a3d42';
    ctx.fillRect(0, 0, c.width, c.height);
    renderFrame(ctx, p, { time: comp ? Math.min(comp.duration, comp.markers.inEnd + 0.5) : 0, clock: 4, env, width: c.width, height: c.height });
    const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export function PackDialog({ host, env, onClose, onDone }: { host: Host; env: BrowserEnv; onClose: () => void; onDone: (status: string) => void }) {
  const [list, setList] = useState<LibraryEntry[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [name, setName] = useState('My titles');
  const [author, setAuthor] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [license, setLicense] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void host
      .listLibrary()
      .then((l) => {
        setList(l);
        setChosen(new Set(l.map((x) => x.id)));
      })
      .catch((e) => setError(String(e)));
  }, [host]);
  const toggle = (id: string) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const titles: TitleProject[] = [];
      for (const e of list.filter((x) => chosen.has(x.id))) {
        const r = await host.readLibrary(e.id);
        if (r.project) titles.push(await selfContained(r.project, host));
      }
      const thumbs = [];
      for (const t of titles) thumbs.push(await thumbnail(t, env));
      const info = {
        name: name.trim() || 'Titles',
        ...(author.trim() ? { author: author.trim() } : {}),
        ...(version.trim() ? { version: version.trim() } : {}),
        ...(license.trim() ? { license: license.trim() } : {}),
      };
      const bytes = await writePack(info, titles, thumbs);
      download(`${slug(info.name)}.${PACK_EXTENSION}`, new Blob([bytes as BlobPart], { type: 'application/zip' }));
      onDone(`Saved the pack ${info.name} (${titles.length} title${titles.length === 1 ? '' : 's'})`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tt-modal" role="dialog" aria-label="Share as a pack">
      <div className="tt-modal-box tt-export">
        <h2>Share as a pack</h2>
        <p className="tt-dim">One file with the titles, their pictures and fonts, to hand to another team or computer. It opens with Import.</p>
        {list.length === 0 ? (
          <p className="tt-dim">Save titles to the library first.</p>
        ) : (
          <div className="tt-pack-list" aria-label="Titles in the pack">
            {list.map((e) => (
              <label key={e.id} className="tt-check">
                <input type="checkbox" checked={chosen.has(e.id)} onChange={() => toggle(e.id)} />
                {e.name} <span className="tt-dim tt-small">{e.category}</span>
              </label>
            ))}
          </div>
        )}
        <label className="tt-field">
          <span className="tt-field-label">Pack name</span>
          <input className="tt-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="tt-field">
          <span className="tt-field-label">Made by</span>
          <input className="tt-input" value={author} placeholder="Optional" onChange={(e) => setAuthor(e.target.value)} />
        </label>
        <label className="tt-field">
          <span className="tt-field-label">Version</span>
          <input className="tt-input" value={version} onChange={(e) => setVersion(e.target.value)} />
        </label>
        <label className="tt-field">
          <span className="tt-field-label">License</span>
          <input className="tt-input" value={license} placeholder="Optional, e.g. CC-BY-4.0" onChange={(e) => setLicense(e.target.value)} />
        </label>
        {error && <div className="tt-error">{error}</div>}
        <div className="tt-modal-actions">
          <button className="tt-plain" onClick={onClose}>
            Cancel
          </button>
          <button className="tt-primary" disabled={busy || !chosen.size} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save pack'}
          </button>
        </div>
      </div>
    </div>
  );
}
