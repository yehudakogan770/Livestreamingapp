// The start screen: new documents by size, open a file, recent files.

import { useState } from 'react';
import { FilePlus, FolderOpen, X } from 'lucide-react';
import { addSession, openDialog, toast } from '../app/state';
import { openDialog as openFiles, openPicked } from '../app/files';
import { recentFiles, forgetRecent, getHandle, type RecentFile } from '../app/recent';
import { getHost } from '../app/host';
import { PRESETS, type Preset } from '../app/templates';
import { blankDoc } from '../core/doc';
import { SRGB } from '../core/color';
import { Mark } from './Mark';

export function newFromPreset(p: Preset): void {
  addSession(
    blankDoc({
      name: 'Untitled-1',
      width: p.width,
      height: p.height,
      depth: p.depth ?? 8,
      resolution: p.resolution,
      profile: SRGB,
      background: p.background ?? 'white',
    }),
  );
}

export async function openRecent(r: RecentFile): Promise<void> {
  try {
    const host = getHost();
    if (r.path && host.readPath) {
      const bytes = await host.readPath(r.path);
      await openPicked([{ name: r.name, bytes, path: r.path }]);
      return;
    }
    const h = await getHandle(r.id);
    if (h) {
      const perm = (h as unknown as { requestPermission?: (o: { mode: string }) => Promise<string> }).requestPermission;
      if (perm && (await perm.call(h, { mode: 'readwrite' })) !== 'granted') return;
      const f = await h.getFile();
      await openPicked([{ name: r.name, bytes: new Uint8Array(await f.arrayBuffer()), handle: h }]);
      return;
    }
    toast('This browser can’t reopen that file by itself. Use Open to pick it again.');
    await openFiles();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

function PageThumb({ w, h, transparent }: { w: number; h: number; transparent?: boolean }) {
  const k = Math.min(120 / w, 84 / h);
  return (
    <span
      className="lp-start-page"
      style={{
        width: Math.max(8, w * k),
        height: Math.max(8, h * k),
        background: transparent ? 'repeating-conic-gradient(#d4d4d4 0% 25%, #ffffff 0% 50%) 50% / 8px 8px' : '#fff',
      }}
    />
  );
}

export function StartScreen() {
  const [recent, setRecent] = useState(recentFiles());
  const sizes = PRESETS.filter((p) =>
    ['Photo, 6 × 4 in', 'A4', 'Square post', 'Story', 'HD 1080p', '4K UHD', 'Overlay for Lumora', 'Video thumbnail'].includes(p.name),
  );
  return (
    <div className="lp-start">
      <div className="lp-start-side">
        <div className="lp-start-brand">
          <Mark size={28} />
          <span>Lumora Photo</span>
        </div>
        <button className="lp-btn lp-primary" onClick={() => openDialog('newDoc')}>
          <FilePlus size={15} /> New file
        </button>
        <button className="lp-btn" onClick={() => void openFiles()}>
          <FolderOpen size={15} /> Open
        </button>
        <span style={{ flex: 1 }} />
        <div className="lp-note">Drop pictures or Photoshop files anywhere to open them.</div>
      </div>
      <div className="lp-start-body">
        <h2>New document</h2>
        <div className="lp-start-grid">
          {sizes.map((p) => (
            <button key={p.name} className="lp-start-card" onClick={() => newFromPreset(p)}>
              <span className="lp-start-thumb">
                <PageThumb w={p.width} h={p.height} transparent={p.background === 'transparent'} />
              </span>
              <span className="lp-start-name">{p.name}</span>
              <span className="lp-start-sub">
                {p.width} × {p.height} px{p.resolution !== 72 ? `, ${p.resolution} ppi` : ''}
              </span>
            </button>
          ))}
          <button className="lp-start-card" onClick={() => openDialog('newDoc')}>
            <span className="lp-start-thumb">
              <FilePlus size={22} />
            </span>
            <span className="lp-start-name">More sizes…</span>
            <span className="lp-start-sub">Any size, color and depth</span>
          </button>
        </div>
        <h2>Recent</h2>
        {recent.length ? (
          <div className="lp-start-grid">
            {recent.map((r) => (
              <div key={r.id} style={{ position: 'relative' }}>
                <button className="lp-start-card" style={{ width: '100%' }} onClick={() => void openRecent(r)} title={r.path ?? r.name}>
                  <span className="lp-start-thumb">{r.thumb ? <img src={r.thumb} alt="" /> : null}</span>
                  <span className="lp-start-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.name}
                  </span>
                  <span className="lp-start-sub">
                    {r.size} px · {new Date(r.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </button>
                <button
                  className="lp-icon-btn"
                  style={{ position: 'absolute', right: 4, top: 4, width: 22, height: 22, background: 'var(--raised)' }}
                  aria-label={`Remove ${r.name} from Recent`}
                  title="Remove from Recent"
                  onClick={() => {
                    forgetRecent(r.id);
                    setRecent(recentFiles());
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="lp-note">Files you open and save appear here.</div>
        )}
      </div>
    </div>
  );
}
