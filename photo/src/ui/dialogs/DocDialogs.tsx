// New Document, Image Size and Canvas Size.

import { useState } from 'react';
import { Link2, Unlink2 } from 'lucide-react';
import { addSession, app, current } from '../../app/state';
import { run } from '../../app/commands';
import { Dialog, OkCancel, NumberField, Select, Check, ColorWell } from '../fields';
import { blankDoc, MAX_SIDE, type Background } from '../../core/doc';
import { PROFILES, profileById } from '../../core/color';
import { PRESETS } from '../../app/templates';
import type { Depth } from '../../core/types';
import type { Resample } from '../../core/img';
import { ColorPickerDialog } from './ColorDialogs';

type Unit = 'px' | 'in' | 'cm' | 'mm' | 'pt' | 'percent';

const toPx = (v: number, u: Unit, res: number, base = 0) =>
  u === 'px' ? v : u === 'in' ? v * res : u === 'cm' ? (v / 2.54) * res : u === 'mm' ? (v / 25.4) * res : u === 'pt' ? (v / 72) * res : (v / 100) * base;
const fromPx = (px: number, u: Unit, res: number, base = 0) =>
  u === 'px'
    ? px
    : u === 'in'
      ? px / res
      : u === 'cm'
        ? (px / res) * 2.54
        : u === 'mm'
          ? (px / res) * 25.4
          : u === 'pt'
            ? (px / res) * 72
            : base
              ? (px / base) * 100
              : 100;
const UNIT_OPTS = (percent: boolean): [Unit, string][] => [
  ...(percent ? ([['percent', 'Percent']] as [Unit, string][]) : []),
  ['px', 'Pixels'],
  ['in', 'Inches'],
  ['cm', 'Centimeters'],
  ['mm', 'Millimeters'],
  ['pt', 'Points'],
];
const digitsFor = (u: Unit) => (u === 'px' ? 0 : u === 'percent' ? 1 : 2);

export function NewDocDialog({ onClose, fromClip }: { onClose: () => void; fromClip?: boolean }) {
  const [name, setName] = useState('Untitled-1');
  const [w, setW] = useState(1920);
  const [h, setH] = useState(1080);
  const [unit, setUnit] = useState<Unit>('px');
  const [res, setRes] = useState(72);
  const [depth, setDepth] = useState<Depth>(8);
  const [profile, setProfile] = useState('srgb');
  const [bg, setBg] = useState<Background>('white');
  const [color, setColor] = useState<[number, number, number]>([1, 1, 1]);
  const [preset, setPreset] = useState('');
  const [picking, setPicking] = useState(false);
  void fromClip;
  const create = () => {
    onClose();
    addSession(
      blankDoc({
        name: name || 'Untitled-1',
        width: Math.round(w),
        height: Math.round(h),
        depth,
        resolution: res,
        profile: profileById(profile),
        background: bg,
        color: [...color, 1],
      }),
    );
  };
  const big = w * h > 200e6;
  return (
    <Dialog
      title="New Document"
      onClose={onClose}
      width={520}
      foot={<OkCancel onOk={create} onCancel={onClose} ok="Create" disabled={w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE} />}
    >
      <div className="lp-form">
        <label>Preset</label>
        <Select
          value={preset}
          options={[
            ['', 'Custom'] as [string, string],
            ...PRESETS.map((p) => [p.name, `${p.group}: ${p.name} (${p.width} × ${p.height})`] as [string, string]),
          ]}
          onChange={(v) => {
            setPreset(v);
            const p = PRESETS.find((x) => x.name === v);
            if (!p) return;
            setW(p.width);
            setH(p.height);
            setRes(p.resolution);
            setBg(p.background ?? 'white');
            setUnit(p.resolution >= 150 ? 'in' : 'px');
          }}
        />
        <label>Name</label>
        <input className="lp-input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} aria-label="Name" />
        <label>Width</label>
        <span className="lp-inline">
          <NumberField
            value={fromPx(w, unit, res)}
            digits={digitsFor(unit)}
            min={0.01}
            max={MAX_SIDE}
            width={80}
            onChange={(v) => setW(Math.round(toPx(v, unit, res)))}
            title="Width"
          />
          <Select value={unit} options={UNIT_OPTS(false)} onChange={setUnit} title="Units" />
        </span>
        <label>Height</label>
        <NumberField
          value={fromPx(h, unit, res)}
          digits={digitsFor(unit)}
          min={0.01}
          max={MAX_SIDE}
          width={80}
          onChange={(v) => setH(Math.round(toPx(v, unit, res)))}
          title="Height"
        />
        <label>Resolution</label>
        <NumberField value={res} min={1} max={10000} suffix="pixels/inch" width={80} onChange={setRes} title="Resolution" />
        <label>Color Mode</label>
        <span className="lp-inline">
          RGB Color
          <Select
            value={depth}
            options={[
              [8, '8 bit'],
              [16, '16 bit'],
              [32, '32 bit'],
            ]}
            onChange={setDepth}
            title="Bit depth"
          />
        </span>
        <label>Background</label>
        <span className="lp-inline">
          <Select
            value={bg}
            options={[
              ['white', 'White'],
              ['black', 'Black'],
              ['color', 'Background Color'],
              ['transparent', 'Transparent'],
            ]}
            onChange={(v) => {
              setBg(v);
              if (v === 'color') setColor(app.get().bg);
            }}
          />
          {bg === 'color' && <ColorWell color={color} title="Background color" onClick={() => setPicking(true)} />}
        </span>
        <label>Color Profile</label>
        <Select value={profile} options={PROFILES.map((p) => [p.id, p.name] as [string, string])} onChange={setProfile} />
        <label />
        <span className="lp-note">
          {w} × {h} px, {formatBytes(w * h * 4 * (depth / 8))}
          {big ? ' — very large; it may be slow on this computer.' : ''}
        </span>
      </div>
      {picking && <ColorPickerDialog p={{ color, onPick: (c: [number, number, number]) => setColor(c) }} onClose={() => setPicking(false)} />}
    </Dialog>
  );
}

export function formatBytes(n: number): string {
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

const RESAMPLE: [Resample, string][] = [
  ['bicubic', 'Bicubic (smooth gradients)'],
  ['lanczos', 'Lanczos (sharper, for reduction)'],
  ['bilinear', 'Bilinear'],
  ['nearest', 'Nearest Neighbor (hard edges)'],
];

export function ImageSizeDialog({ onClose }: { onClose: () => void }) {
  const s = current()!;
  const d = s.doc;
  const [w, setW] = useState(d.width);
  const [h, setH] = useState(d.height);
  const [res, setRes] = useState(d.resolution);
  const [unit, setUnit] = useState<Unit>('px');
  const [link, setLink] = useState(true);
  const [resample, setResample] = useState(true);
  const [method, setMethod] = useState<Resample>('bicubic');
  const setWidth = (px: number) => {
    setW(px);
    if (link) setH(Math.max(1, Math.round((px * d.height) / d.width)));
  };
  const setHeight = (px: number) => {
    setH(px);
    if (link) setW(Math.max(1, Math.round((px * d.width) / d.height)));
  };
  const ok = () => {
    onClose();
    if (!resample) {
      // Only the resolution (print size) changes.
      void run('image.resizeTo', { w: d.width, h: d.height, method, resolution: res });
      return;
    }
    void run('image.resizeTo', { w, h, method, resolution: res });
  };
  return (
    <Dialog title="Image Size" onClose={onClose} width={480} foot={<OkCancel onOk={ok} onCancel={onClose} />}>
      <div className="lp-form">
        <label>Image Size</label>
        <span>
          {formatBytes(w * h * 4 * (d.depth / 8))} (was {formatBytes(d.width * d.height * 4 * (d.depth / 8))})
        </span>
        <label>Dimensions</label>
        <span>
          {w} px × {h} px
        </span>
        <label>Width</label>
        <span className="lp-inline">
          <NumberField
            value={fromPx(w, unit, res, d.width)}
            digits={digitsFor(unit)}
            min={0.01}
            max={MAX_SIDE}
            width={80}
            onChange={(v) => setWidth(Math.max(1, Math.round(toPx(v, unit, res, d.width))))}
            title="Width"
          />
          <Select value={unit} options={UNIT_OPTS(true)} onChange={setUnit} title="Units" />
          <button className="lp-icon-btn" aria-pressed={link} title="Constrain proportions" aria-label="Constrain proportions" onClick={() => setLink(!link)}>
            {link ? <Link2 size={15} /> : <Unlink2 size={15} />}
          </button>
        </span>
        <label>Height</label>
        <NumberField
          value={fromPx(h, unit, res, d.height)}
          digits={digitsFor(unit)}
          min={0.01}
          max={MAX_SIDE}
          width={80}
          onChange={(v) => setHeight(Math.max(1, Math.round(toPx(v, unit, res, d.height))))}
          title="Height"
        />
        <label>Resolution</label>
        <NumberField
          value={res}
          min={1}
          max={10000}
          digits={1}
          suffix="pixels/inch"
          width={80}
          onChange={(v) => {
            // Without resampling the print size follows; with it the pixels do (when sizing in print units).
            if (resample && unit !== 'px' && unit !== 'percent') {
              setW(Math.round((w * v) / res));
              setH(Math.round((h * v) / res));
            }
            setRes(v);
          }}
          title="Resolution"
        />
        <label />
        <Check
          label="Resample"
          checked={resample}
          onChange={(v) => {
            setResample(v);
            if (!v) {
              setW(d.width);
              setH(d.height);
            }
          }}
        />
        {resample && (
          <>
            <label>Method</label>
            <Select value={method} options={RESAMPLE} onChange={setMethod} />
          </>
        )}
      </div>
    </Dialog>
  );
}

export function CanvasSizeDialog({ onClose }: { onClose: () => void }) {
  const s = current()!;
  const d = s.doc;
  const [w, setW] = useState(d.width);
  const [h, setH] = useState(d.height);
  const [rel, setRel] = useState(false);
  const [ax, setAx] = useState(0.5);
  const [ay, setAy] = useState(0.5);
  const [ext, setExt] = useState<'bg' | 'fg' | 'white' | 'black' | 'transparent'>('bg');
  const ok = () => {
    onClose();
    const st = app.get();
    const fill: [number, number, number, number] | null =
      ext === 'transparent' ? null : ext === 'white' ? [1, 1, 1, 1] : ext === 'black' ? [0, 0, 0, 1] : ext === 'fg' ? [...st.fg, 1] : [...st.bg, 1];
    void run('image.canvasTo', { w, h, ax, ay, fill });
  };
  return (
    <Dialog title="Canvas Size" onClose={onClose} width={440} foot={<OkCancel onOk={ok} onCancel={onClose} />}>
      <div className="lp-form">
        <label>Current Size</label>
        <span>
          {d.width} × {d.height} px
        </span>
        <label>Width</label>
        <NumberField
          value={rel ? w - d.width : w}
          min={rel ? -d.width + 1 : 1}
          max={MAX_SIDE}
          suffix="px"
          width={80}
          onChange={(v) => setW(rel ? d.width + v : v)}
          title="Width"
        />
        <label>Height</label>
        <NumberField
          value={rel ? h - d.height : h}
          min={rel ? -d.height + 1 : 1}
          max={MAX_SIDE}
          suffix="px"
          width={80}
          onChange={(v) => setH(rel ? d.height + v : v)}
          title="Height"
        />
        <label />
        <Check label="Relative" checked={rel} onChange={setRel} />
        <label>Anchor</label>
        <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 24px)', gap: 2 }}>
          {[0, 0.5, 1].flatMap((y) =>
            [0, 0.5, 1].map((x) => (
              <button
                key={`${x}${y}`}
                className="lp-icon-btn"
                style={{ width: 24, height: 24, border: '1px solid var(--line-2)', background: ax === x && ay === y ? 'var(--accent)' : undefined }}
                aria-label={`Anchor ${y === 0 ? 'top' : y === 1 ? 'bottom' : 'middle'} ${x === 0 ? 'left' : x === 1 ? 'right' : 'center'}`}
                aria-pressed={ax === x && ay === y}
                onClick={() => {
                  setAx(x);
                  setAy(y);
                }}
              />
            )),
          )}
        </span>
        <label>Extension Color</label>
        <Select
          value={ext}
          options={[
            ['bg', 'Background'],
            ['fg', 'Foreground'],
            ['white', 'White'],
            ['black', 'Black'],
            ['transparent', 'Transparent'],
          ]}
          onChange={setExt}
        />
      </div>
    </Dialog>
  );
}
