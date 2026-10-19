// Keyboard Shortcuts, Preferences, Print, Batch and About.

import { useEffect, useMemo, useState } from 'react';
import { app, current, useApp, addSession, removeSession, busy, toast, DEFAULT_PREFS, type Prefs } from '../../app/state';
import { allCommands, shortcutOf, setShortcut, resetShortcuts, shortcutLabel, eventKeys } from '../../app/commands';
import { Dialog, OkCancel, NumberField, Select, Check } from '../fields';
import { getActions, play } from '../../app/actions';
import { getHost } from '../../app/host';
import { OPEN_FILTERS, docFromBytes, exportBytes, EXPORT_LABEL, type ExportFormat } from '../../app/files';
import { Mark } from '../Mark';

const CATEGORY: Record<string, string> = { file: 'File', edit: 'Edit', image: 'Image', layer: 'Layer', select: 'Select', filter: 'Filter', view: 'View', window: 'Window', help: 'Help', key: 'Other', tool: 'Tools' };

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const list = useMemo(() => allCommands().filter((c) => !c.id.startsWith('tool.shift.') && !/\.apply$|With$|To$|By$/.test(c.id) && c.id !== 'edit.clear2' && c.id !== 'view.zoomIn2'), []);
  useEffect(() => {
    if (!editing) return;
    const key = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setEditing(null);
      if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setShortcut(editing, '');
        setEditing(null);
        return;
      }
      const k = eventKeys(e);
      if (!k || ['Ctrl', 'Alt', 'Shift', 'Ctrl+Shift', 'Ctrl+Alt', 'Alt+Shift', 'Ctrl+Alt+Shift'].includes(k)) return;
      setShortcut(editing, k);
      setEditing(null);
      setTick((t) => t + 1);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [editing]);
  const shown = list.filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()) || shortcutOf(c.id).toLowerCase().includes(q.toLowerCase()));
  const groups = new Map<string, typeof shown>();
  for (const c of shown) {
    const g = CATEGORY[c.id.split('.')[0]!] ?? 'Other';
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  return (
    <Dialog
      title="Keyboard Shortcuts"
      onClose={onClose}
      width={620}
      foot={
        <>
          <button
            className="lp-btn"
            onClick={() => {
              resetShortcuts();
              setTick((t) => t + 1);
            }}
          >
            Use Photoshop Defaults
          </button>
          <span className="lp-spacer" />
          <button className="lp-btn lp-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <input className="lp-input" style={{ width: '100%', marginBottom: 10 }} placeholder="Search commands or keys" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="Search shortcuts" />
      <div style={{ maxHeight: 420, overflow: 'auto' }}>
        {[...groups].map(([g, cmds]) => (
          <div key={g}>
            <div className="lp-section-title">{g}</div>
            {cmds.map((c) => (
              <div key={c.id} className="lp-row" style={{ minHeight: 28 }}>
                <span className="lp-grow">{c.label.replace(/…$/, '')}</span>
                <button className="lp-btn" style={{ minWidth: 130, height: 22, fontFamily: 'var(--mono)', fontSize: 11 }} onClick={() => setEditing(c.id)}>
                  {editing === c.id ? 'Press keys…' : shortcutLabel(shortcutOf(c.id)) || '—'}
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="lp-note" style={{ marginTop: 8 }}>
        Click a shortcut and press the new keys. Backspace removes it; a key already used moves here.
      </div>
    </Dialog>
  );
}

export function PrefsDialog({ onClose }: { onClose: () => void }) {
  const prefs = useApp((s) => s.prefs);
  const theme = useApp((s) => s.theme);
  const [p, setP] = useState<Prefs>(prefs);
  const set = (patch: Partial<Prefs>) => setP({ ...p, ...patch });
  return (
    <Dialog
      title="Preferences"
      onClose={onClose}
      width={480}
      foot={
        <>
          <button className="lp-btn" onClick={() => setP(DEFAULT_PREFS)}>
            Reset
          </button>
          <OkCancel
            onOk={() => {
              app.set({ prefs: p });
              for (const s of app.get().sessions) s.history.limit = p.historyStates;
              onClose();
            }}
            onCancel={onClose}
          />
        </>
      }
    >
      <div className="lp-form">
        <label>Interface</label>
        <Select
          value={theme}
          options={[
            ['dark', 'Dark'],
            ['light', 'Light'],
          ]}
          onChange={(v) => app.set({ theme: v })}
        />
        <label>History States</label>
        <NumberField value={p.historyStates} min={20} max={5000} onChange={(v) => set({ historyStates: v })} />
        <label>Zoom with Wheel</label>
        <Check label="Scroll wheel zooms (otherwise Alt+wheel)" checked={p.zoomWithWheel} onChange={(v) => set({ zoomWithWheel: v })} />
        <label>Brush Cursor</label>
        <Check label="Show crosshair in brush tip" checked={p.showBrushCrosshair} onChange={(v) => set({ showBrushCrosshair: v })} />
        <label>Grid Every</label>
        <NumberField value={p.gridSpacing} min={2} max={5000} suffix="px" onChange={(v) => set({ gridSpacing: v })} />
        <label>Subdivisions</label>
        <NumberField value={p.gridSubdivisions} min={1} max={20} onChange={(v) => set({ gridSubdivisions: v })} />
        <label>Guide Color</label>
        <input type="color" value={p.guideColor} onChange={(e) => set({ guideColor: e.target.value })} aria-label="Guide color" style={{ width: 48, height: 24, border: 0, background: 'none' }} />
        <label>Display</label>
        <Check label="Use the wide-gamut (P3) display when there is one" checked={p.displayP3} onChange={(v) => set({ displayP3: v })} />
        <label>Recovery</label>
        <span className="lp-inline">
          Save recovery information every
          <NumberField value={p.autosaveMinutes} min={1} max={60} suffix="min" width={36} onChange={(v) => set({ autosaveMinutes: v })} />
        </span>
      </div>
    </Dialog>
  );
}

export function PrintDialog({ onClose }: { onClose: () => void }) {
  const s = current()!;
  const d = s.doc;
  const [fit, setFit] = useState<'size' | 'page'>('size');
  const [paper, setPaper] = useState<'letter' | 'a4' | 'legal' | 'tabloid'>('letter');
  const [orient, setOrient] = useState<'portrait' | 'landscape'>(d.width > d.height ? 'landscape' : 'portrait');
  const [url, setUrl] = useState('');
  useEffect(() => {
    let u = '';
    void exportBytes(d, { format: 'png', quality: 1, scale: 1, depth: 8, embedProfile: true, toSrgb: true, transparency: false, background: [1, 1, 1] }).then((b) => {
      u = URL.createObjectURL(new Blob([b as BlobPart], { type: 'image/png' }));
      setUrl(u);
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [d]);
  const sizes = { letter: [8.5, 11], a4: [8.27, 11.69], legal: [8.5, 14], tabloid: [11, 17] } as const;
  const [pw, ph] = orient === 'portrait' ? sizes[paper] : [sizes[paper][1], sizes[paper][0]];
  const iw = d.width / d.resolution,
    ih = d.height / d.resolution;
  const k = fit === 'page' ? Math.min((pw - 0.5) / iw, (ph - 0.5) / ih) : 1;
  const tooBig = fit === 'size' && (iw > pw || ih > ph);
  const scale = 240 / Math.max(pw, ph);
  const print = () => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(f);
    const doc = f.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html><head><title>${d.name.replace(/</g, '')}</title><style>@page{size:${pw}in ${ph}in;margin:0}html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}img{width:${(iw * k).toFixed(3)}in;height:${(ih * k).toFixed(3)}in}</style></head><body><img src="${url}"></body></html>`);
    doc.close();
    const img = doc.querySelector('img')!;
    const go = () => {
      f.contentWindow?.focus();
      f.contentWindow?.print();
      setTimeout(() => f.remove(), 2000);
    };
    if (img.complete) go();
    else img.onload = go;
    onClose();
  };
  return (
    <Dialog title="Print" onClose={onClose} width={620} foot={<OkCancel onOk={print} onCancel={onClose} ok="Print…" disabled={!url} />}>
      <div className="lp-cols">
        <div className="lp-preview-box" style={{ width: 280, height: 280 }}>
          <div style={{ width: pw * scale, height: ph * scale, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
            {url && <img src={url} alt="" style={{ width: iw * k * scale, height: ih * k * scale, maxWidth: 'none', maxHeight: 'none' }} />}
          </div>
        </div>
        <div className="lp-form" style={{ alignContent: 'start', flex: 1 }}>
          <label>Paper</label>
          <Select
            value={paper}
            options={[
              ['letter', 'Letter (8.5 × 11 in)'],
              ['a4', 'A4 (210 × 297 mm)'],
              ['legal', 'Legal (8.5 × 14 in)'],
              ['tabloid', 'Tabloid (11 × 17 in)'],
            ]}
            onChange={setPaper}
          />
          <label>Orientation</label>
          <Select
            value={orient}
            options={[
              ['portrait', 'Portrait'],
              ['landscape', 'Landscape'],
            ]}
            onChange={setOrient}
          />
          <label>Size</label>
          <Select
            value={fit}
            options={[
              ['size', 'Print size (resolution)'],
              ['page', 'Scale to fit the page'],
            ]}
            onChange={setFit}
          />
          <label />
          <span className="lp-note">
            {(iw * k).toFixed(2)} × {(ih * k).toFixed(2)} in at {Math.round(d.resolution / k)} ppi
            {tooBig ? <span className="lp-warning"> — larger than the paper; it will be cut off.</span> : null}
          </span>
          <label />
          <span className="lp-note">Colors are printed as sRGB. The system print dialog picks the printer.</span>
        </div>
      </div>
    </Dialog>
  );
}

export function BatchDialog({ onClose }: { onClose: () => void }) {
  const actions = getActions();
  const [action, setAction] = useState(0);
  const [format, setFormat] = useState<ExportFormat>('jpeg');
  const [files, setFiles] = useState<{ name: string; bytes: Uint8Array }[]>([]);
  const go = async () => {
    onClose();
    const { zip } = await import('../../core/io/zip');
    const out: { name: string; data: Uint8Array; store: boolean }[] = [];
    const errors: string[] = [];
    await busy('Batch…', async (progress) => {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!;
        try {
          const doc = await docFromBytes(f.name, f.bytes);
          const s = addSession(doc);
          await play(action);
          const ext = { jpeg: 'jpg', png: 'png', tiff: 'tif', webp: 'webp', gif: 'gif', bmp: 'bmp', avif: 'avif', psd: 'psd', lumphoto: 'lumphoto' }[format];
          out.push({ name: `${s.doc.name}.${ext}`, data: await exportBytes(s.doc, { format, quality: 0.9, scale: 1, depth: 8, embedProfile: true, toSrgb: true, transparency: format !== 'jpeg', background: [1, 1, 1] }), store: true });
          removeSession(s.id);
        } catch (e) {
          errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
        progress((i + 1) / files.length);
      }
    });
    if (out.length) await getHost().saveFile('Batch.zip', await zip(out), [{ name: 'Zip', extensions: ['zip'] }]);
    toast(`Batch finished: ${out.length} of ${files.length} files.${errors.length ? ` ${errors[0]}` : ''}`, errors.length ? 'error' : 'info');
  };
  return (
    <Dialog title="Batch" onClose={onClose} width={460} foot={<OkCancel onOk={() => void go()} onCancel={onClose} ok="Run" disabled={!files.length || !actions.length} />}>
      <div className="lp-form">
        <label>Action</label>
        <Select value={action} options={actions.map((a, i) => [i, a.name] as [number, string])} onChange={setAction} />
        <label>Files</label>
        <span className="lp-inline">
          <button className="lp-btn" onClick={async () => setFiles(await getHost().openFiles(OPEN_FILTERS, true))}>
            Choose…
          </button>
          <span className="lp-note">{files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'None chosen'}</span>
        </span>
        <label>Save As</label>
        <Select value={format} options={(['jpeg', 'png', 'tiff', 'webp'] as ExportFormat[]).map((f) => [f, EXPORT_LABEL[f]] as [ExportFormat, string])} onChange={setFormat} />
        <label />
        <span className="lp-note">Each file is opened, the action is played, and the results are saved together in one zip file. The originals are not changed.</span>
      </div>
    </Dialog>
  );
}

declare const __PHOTO_VERSION__: string | undefined;

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const version = typeof __PHOTO_VERSION__ === 'string' ? __PHOTO_VERSION__ : '';
  return (
    <Dialog title="About Lumora Photo" onClose={onClose} width={400} foot={<button className="lp-btn lp-primary" onClick={onClose}>Close</button>}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <Mark size={48} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Lumora Photo</div>
          <div className="lp-note">{version ? `Version ${version}` : 'Photo editing and design, free.'}</div>
        </div>
      </div>
      <p className="lp-note">Everything runs on this computer: no account, no uploads. Opens and saves Photoshop files with their layers, and works with Lumora, Lumora Studio and Lumora Titler.</p>
    </Dialog>
  );
}
