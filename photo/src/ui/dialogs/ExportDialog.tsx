// Export As: format, quality, size, color and transparency, with a preview
// of the result and its file size; presets for common uses.

import { useEffect, useRef, useState } from 'react';
import { current } from '../../app/state';
import { Dialog, OkCancel, NumberField, Select, Check, Slider, ColorWell } from '../fields';
import { ColorPickerDialog } from './ColorDialogs';
import { exportFormats, exportBytes, exportAs, exportParts, EXPORT_LABEL, type ExportFormat, type ExportOptions } from '../../app/files';
import { formatBytes } from './DocDialogs';
import type { Resample } from '../../core/img';

interface Preset {
  name: string;
  o: Partial<ExportOptions> & { format: ExportFormat };
  maxSide?: number;
}

const PRESETS: Preset[] = [
  { name: 'Web: JPEG, sRGB, 80%', o: { format: 'jpeg', quality: 0.8, toSrgb: true, embedProfile: true } },
  { name: 'Web: PNG with transparency', o: { format: 'png', depth: 8, toSrgb: true, transparency: true } },
  { name: 'Social: 2048 px JPEG', o: { format: 'jpeg', quality: 0.85, toSrgb: true }, maxSide: 2048 },
  { name: 'Print: TIFF, 16-bit', o: { format: 'tiff', depth: 16, toSrgb: false, embedProfile: true } },
  { name: 'Archive: PNG, 16-bit', o: { format: 'png', depth: 16, toSrgb: false, embedProfile: true } },
  { name: 'Video overlay: PNG, transparent', o: { format: 'png', depth: 8, toSrgb: true, transparency: true } },
];

export function ExportDialog({ onClose, parts }: { onClose: () => void; parts?: 'artboards' | 'slices' }) {
  const s = current()!;
  const d = s.doc;
  const [formats, setFormats] = useState<ExportFormat[]>(['png', 'jpeg', 'gif', 'tiff', 'bmp']);
  const [o, setO] = useState<ExportOptions>({
    format: 'png',
    quality: 0.9,
    scale: 1,
    depth: 8,
    embedProfile: true,
    toSrgb: d.profile.id !== 'srgb',
    transparency: true,
    background: [1, 1, 1],
    resample: 'bicubic',
    colors: 256,
    dither: true,
  });
  const [w, setW] = useState(d.width);
  const [h, setH] = useState(d.height);
  const [name, setName] = useState(d.name);
  const [preview, setPreview] = useState<{ url: string; size: number; estimated: boolean } | null>(null);
  const [picking, setPicking] = useState(false);
  const t = useRef(0);
  useEffect(() => {
    void exportFormats().then(setFormats);
  }, []);
  const set = (p: Partial<ExportOptions>) => setO((cur) => ({ ...cur, ...p }));
  const setWidth = (v: number) => {
    setW(v);
    setH(Math.max(1, Math.round((v * d.height) / d.width)));
  };
  const opts = (): ExportOptions => ({ ...o, scale: 1, width: w, height: h });

  // Preview (debounced): the real file for small pictures, a scaled one for large ones.
  useEffect(() => {
    clearTimeout(t.current);
    t.current = window.setTimeout(async () => {
      try {
        const k = Math.min(1, 1200 / Math.max(w, h));
        const bytes = await exportBytes(d, { ...o, width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) });
        const mime = {
          png: 'image/png',
          jpeg: 'image/jpeg',
          webp: 'image/webp',
          avif: 'image/avif',
          gif: 'image/gif',
          bmp: 'image/bmp',
          tiff: '',
          psd: '',
          lumphoto: '',
        }[o.format];
        const url = mime ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })) : '';
        setPreview((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return { url, size: k < 1 ? bytes.length / (k * k) : bytes.length, estimated: k < 1 };
        });
      } catch {
        setPreview(null);
      }
    }, 250);
    return () => clearTimeout(t.current);
  }, [o, w, h, d]);

  const ok = async () => {
    onClose();
    if (parts) await exportParts(parts, { ...o, scale: w / d.width });
    else await exportAs(opts(), name);
  };
  const lossy = o.format === 'jpeg' || o.format === 'webp' || o.format === 'avif';
  return (
    <Dialog
      title={parts ? `Export ${parts === 'artboards' ? 'Artboards' : 'Slices'}` : 'Export As'}
      onClose={onClose}
      width={820}
      foot={<OkCancel onOk={() => void ok()} onCancel={onClose} ok="Export" />}
    >
      <div className="lp-cols">
        <div className="lp-preview-box" style={{ flex: 1, minHeight: 380 }}>
          {preview?.url ? (
            <img src={preview.url} alt="Export preview" />
          ) : (
            <span className="lp-note">{o.format === 'tiff' ? 'TIFF files are not shown here.' : 'Preparing the preview…'}</span>
          )}
        </div>
        <div style={{ width: 290, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Select
            label="Preset"
            value=""
            options={[['', 'Choose a preset…'] as [string, string], ...PRESETS.map((p) => [p.name, p.name] as [string, string])]}
            onChange={(v) => {
              const p = PRESETS.find((x) => x.name === v);
              if (!p) return;
              set({ transparency: false, ...p.o });
              if (p.maxSide && Math.max(d.width, d.height) > p.maxSide) {
                const k = p.maxSide / Math.max(d.width, d.height);
                setW(Math.round(d.width * k));
                setH(Math.round(d.height * k));
              } else {
                setW(d.width);
                setH(d.height);
              }
            }}
          />
          {!parts && (
            <span className="lp-opt">
              <span>Name</span>
              <input
                className="lp-input"
                style={{ flex: 1 }}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label="File name"
              />
            </span>
          )}
          <div className="lp-section-title">File Settings</div>
          <Select
            label="Format"
            value={o.format}
            options={formats.map((f) => [f, EXPORT_LABEL[f]] as [ExportFormat, string])}
            onChange={(v) => set({ format: v })}
          />
          {lossy && <Slider label="Quality" value={o.quality} min={0.05} max={1} step={0.01} scale={100} suffix="%" onChange={(v) => set({ quality: v })} />}
          {(o.format === 'png' || o.format === 'tiff') && d.depth !== 8 && (
            <Select
              label="Bit depth"
              value={o.depth}
              options={[
                [8, '8 bits/channel'],
                [16, '16 bits/channel'],
              ]}
              onChange={(v) => set({ depth: v })}
            />
          )}
          {o.format === 'gif' && (
            <>
              <NumberField label="Colors" value={o.colors ?? 256} min={2} max={256} onChange={(v) => set({ colors: v })} />
              <Check label="Dither" checked={o.dither ?? true} onChange={(v) => set({ dither: v })} />
            </>
          )}
          {o.format !== 'jpeg' && o.format !== 'bmp' && <Check label="Transparency" checked={o.transparency} onChange={(v) => set({ transparency: v })} />}
          {(!o.transparency || o.format === 'jpeg' || o.format === 'bmp') && (
            <span className="lp-opt">
              <span>Matte</span>
              <ColorWell color={o.background} title="Matte color" onClick={() => setPicking(true)} />
            </span>
          )}
          <div className="lp-section-title">Image Size</div>
          <NumberField label="Width" value={w} min={1} max={30000} suffix="px" onChange={setWidth} />
          <NumberField
            label="Height"
            value={h}
            min={1}
            max={30000}
            suffix="px"
            onChange={(v) => {
              setH(v);
              setW(Math.max(1, Math.round((v * d.width) / d.height)));
            }}
          />
          <span className="lp-opt">
            <span>Scale</span>
            <Select
              value={String(Math.round((w / d.width) * 100))}
              options={[...new Set(['25', '50', '75', '100', '150', '200', '300', String(Math.round((w / d.width) * 100))])].map(
                (v) => [v, `${v}%`] as [string, string],
              )}
              onChange={(v) => setWidth(Math.max(1, Math.round((d.width * parseFloat(v)) / 100)))}
            />
          </span>
          <Select
            label="Resample"
            value={o.resample ?? 'bicubic'}
            options={
              [
                ['bicubic', 'Bicubic'],
                ['lanczos', 'Lanczos'],
                ['bilinear', 'Bilinear'],
                ['nearest', 'Nearest Neighbor'],
              ] as [Resample, string][]
            }
            onChange={(v) => set({ resample: v })}
          />
          <div className="lp-section-title">Color Space</div>
          <Check label="Convert to sRGB" checked={o.toSrgb} onChange={(v) => set({ toSrgb: v })} />
          <Check label="Embed Color Profile" checked={o.embedProfile} onChange={(v) => set({ embedProfile: v })} />
          <div className="lp-note" style={{ marginTop: 'auto' }}>
            {w} × {h} px{preview ? ` · ${preview.estimated ? 'about ' : ''}${formatBytes(preview.size)}` : ''}
          </div>
        </div>
      </div>
      {picking && (
        <ColorPickerDialog p={{ color: o.background, onPick: (c: [number, number, number]) => set({ background: c }) }} onClose={() => setPicking(false)} />
      )}
    </Dialog>
  );
}
