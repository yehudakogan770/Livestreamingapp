// Fill, Stroke, Content-Aware Scale and Color Range.

import { useEffect, useRef, useState } from 'react';
import { app, current } from '../../app/state';
import { run } from '../../app/commands';
import { Dialog, OkCancel, NumberField, Select, Check, ColorWell, Slider } from '../fields';
import { ColorPickerDialog } from './ColorDialogs';
import { BLEND_GROUPS, BLEND_NAMES, type BlendMode } from '../../core/blend';
import { allPatterns } from '../../core/patterns';
import { colorRange, type ColorRangeMode, type SelectOp } from '../../core/selection';
import { sampleSource } from '../../app/tools/selectTools';
import { colorRangeSelect } from '../../app/ops/select';
import { contentAwareScaleLayer } from '../../app/ops/heal';
import type { FillUse } from '../../app/ops/edit';

const BLENDS: [BlendMode, string][] = BLEND_GROUPS.flat().map((m) => [m, BLEND_NAMES[m]]);
type RGB = [number, number, number];

export function FillDialog({ onClose }: { onClose: () => void }) {
  const [use, setUse] = useState<FillUse>(current()?.doc.selection ? 'contentAware' : 'fg');
  const [color, setColor] = useState<RGB>(app.get().fg);
  const [pattern, setPattern] = useState('paper');
  const [mode, setMode] = useState<BlendMode>('normal');
  const [opacity, setOpacity] = useState(100);
  const [preserve, setPreserve] = useState(false);
  const [picking, setPicking] = useState(false);
  const ok = () => {
    onClose();
    if (use === 'contentAware') return void run('edit.contentAwareFill');
    void run('edit.fillWith', { use, color, pattern, mode, opacity: opacity / 100, preserveTransparency: preserve });
  };
  return (
    <Dialog title="Fill" onClose={onClose} width={400} foot={<OkCancel onOk={ok} onCancel={onClose} />}>
      <div className="lp-form">
        <label>Contents</label>
        <span className="lp-inline">
          <Select
            value={use}
            options={[
              ['fg', 'Foreground Color'],
              ['bg', 'Background Color'],
              ['color', 'Color…'],
              ['contentAware', 'Content-Aware'],
              ['pattern', 'Pattern'],
              ['black', 'Black'],
              ['gray', '50% Gray'],
              ['white', 'White'],
            ]}
            onChange={setUse}
          />
          {use === 'color' && <ColorWell color={color} title="Fill color" onClick={() => setPicking(true)} />}
        </span>
        {use === 'pattern' && (
          <>
            <label>Pattern</label>
            <Select value={pattern} options={allPatterns().map((p) => [p.id, p.name] as [string, string])} onChange={setPattern} />
          </>
        )}
        {use !== 'contentAware' && (
          <>
            <label>Mode</label>
            <Select value={mode} options={BLENDS} onChange={setMode} />
            <label>Opacity</label>
            <NumberField value={opacity} min={0} max={100} suffix="%" onChange={setOpacity} />
            <label />
            <Check label="Preserve Transparency" checked={preserve} onChange={setPreserve} />
          </>
        )}
        {use === 'contentAware' && (
          <>
            <label />
            <span className="lp-note">Fills the selection from the picture around it.</span>
          </>
        )}
      </div>
      {picking && <ColorPickerDialog p={{ color, onPick: setColor }} onClose={() => setPicking(false)} />}
    </Dialog>
  );
}

export function StrokeDialog({ onClose }: { onClose: () => void }) {
  const [width, setWidth] = useState(3);
  const [color, setColor] = useState<RGB>(app.get().fg);
  const [location, setLocation] = useState<'inside' | 'center' | 'outside'>('center');
  const [mode, setMode] = useState<BlendMode>('normal');
  const [opacity, setOpacity] = useState(100);
  const [preserve, setPreserve] = useState(false);
  const [picking, setPicking] = useState(false);
  const ok = () => {
    onClose();
    void run('edit.strokeWith', { width, color, location, mode, opacity: opacity / 100, preserveTransparency: preserve });
  };
  return (
    <Dialog title="Stroke" onClose={onClose} width={400} foot={<OkCancel onOk={ok} onCancel={onClose} />}>
      <div className="lp-form">
        <label>Width</label>
        <NumberField value={width} min={1} max={250} suffix="px" onChange={setWidth} />
        <label>Color</label>
        <ColorWell color={color} title="Stroke color" onClick={() => setPicking(true)} />
        <label>Location</label>
        <Select
          value={location}
          options={[
            ['inside', 'Inside'],
            ['center', 'Center'],
            ['outside', 'Outside'],
          ]}
          onChange={setLocation}
        />
        <label>Mode</label>
        <Select value={mode} options={BLENDS} onChange={setMode} />
        <label>Opacity</label>
        <NumberField value={opacity} min={0} max={100} suffix="%" onChange={setOpacity} />
        <label />
        <Check label="Preserve Transparency" checked={preserve} onChange={setPreserve} />
      </div>
      {picking && <ColorPickerDialog p={{ color, onPick: setColor }} onClose={() => setPicking(false)} />}
    </Dialog>
  );
}

export function ContentAwareScaleDialog({ onClose }: { onClose: () => void }) {
  const s = current();
  const [w, setW] = useState(s?.doc.width ?? 1);
  const [h, setH] = useState(s?.doc.height ?? 1);
  const [skin, setSkin] = useState(true);
  const [amount, setAmount] = useState(100);
  if (!s) return null;
  const ok = () => {
    onClose();
    void contentAwareScaleLayer(w, h, skin, amount / 100);
  };
  return (
    <Dialog title="Content-Aware Scale" onClose={onClose} width={420} foot={<OkCancel onOk={ok} onCancel={onClose} />}>
      <p className="lp-note" style={{ marginTop: 0 }}>
        Changes the layer’s size by taking out (or repeating) the least important pixels, so people and objects keep their shape.
      </p>
      <div className="lp-form">
        <label>Width</label>
        <NumberField value={w} min={8} max={s.doc.width * 2} suffix="px" onChange={setW} />
        <label>Height</label>
        <NumberField value={h} min={8} max={s.doc.height * 2} suffix="px" onChange={setH} />
        <label>Amount</label>
        <NumberField value={amount} min={0} max={100} suffix="%" onChange={setAmount} title="100%: content-aware only; 0%: a plain resize" />
        <label />
        <Check label="Protect Skin Tones" checked={skin} onChange={setSkin} />
      </div>
    </Dialog>
  );
}

const RANGE_MODES: [ColorRangeMode, string][] = [
  ['sampled', 'Sampled Colors'],
  ['reds', 'Reds'],
  ['yellows', 'Yellows'],
  ['greens', 'Greens'],
  ['cyans', 'Cyans'],
  ['blues', 'Blues'],
  ['magentas', 'Magentas'],
  ['highlights', 'Highlights'],
  ['midtones', 'Midtones'],
  ['shadows', 'Shadows'],
  ['skin', 'Skin Tones'],
];

export function ColorRangeDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<ColorRangeMode>('sampled');
  const [samples, setSamples] = useState<RGB[]>([app.get().fg]);
  const [fuzz, setFuzz] = useState(40);
  const [op, setOp] = useState<SelectOp>('replace');
  const [pick, setPick] = useState<'set' | 'add' | 'sub'>('set');
  const canvas = useRef<HTMLCanvasElement>(null);
  const [src] = useState(() => {
    const full = sampleSource(true);
    if (!full) return null;
    // A small copy for the preview.
    const k = Math.min(1, 320 / Math.max(full.w, full.h));
    const w = Math.max(1, Math.round(full.w * k)),
      h = Math.max(1, Math.round(full.h * k));
    const data = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const sx = Math.min(full.w - 1, Math.floor(x / k)),
          sy = Math.min(full.h - 1, Math.floor(y / k));
        data.set(full.data.subarray((sy * full.w + sx) * 4, (sy * full.w + sx) * 4 + 4), (y * w + x) * 4);
      }
    return { w, h, data };
  });
  const [show, setShow] = useState<'selection' | 'image'>('selection');
  useEffect(() => {
    const c = canvas.current;
    if (!c || !src) return;
    c.width = src.w;
    c.height = src.h;
    const ctx = c.getContext('2d')!;
    const im = ctx.createImageData(src.w, src.h);
    if (show === 'image') {
      for (let i = 0; i < src.w * src.h; i++) for (let k = 0; k < 4; k++) im.data[i * 4 + k] = Math.round(Math.min(1, Math.max(0, src.data[i * 4 + k]!)) * 255);
    } else {
      const m = colorRange(src, mode, samples, fuzz);
      for (let i = 0; i < src.w * src.h; i++) {
        im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = m.data[i]!;
        im.data[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(im, 0, 0);
  }, [src, mode, samples, fuzz, show]);
  const ok = () => {
    onClose();
    colorRangeSelect(mode, samples, fuzz, op);
  };
  return (
    <Dialog title="Color Range" onClose={onClose} width={560} foot={<OkCancel onOk={ok} onCancel={onClose} />}>
      <div className="lp-cols">
        <div style={{ width: 230 }}>
          <div className="lp-form" style={{ gridTemplateColumns: 'auto 1fr' }}>
            <label>Select</label>
            <Select value={mode} options={RANGE_MODES} onChange={setMode} />
            <label>Result</label>
            <Select
              value={op}
              options={[
                ['replace', 'New Selection'],
                ['add', 'Add'],
                ['subtract', 'Subtract'],
                ['intersect', 'Intersect'],
              ]}
              onChange={setOp}
            />
          </div>
          {mode === 'sampled' && (
            <>
              <div style={{ height: 10 }} />
              <Slider label="Fuzziness" value={fuzz} min={0} max={200} onChange={setFuzz} />
              <div className="lp-section-title">Click the picture to</div>
              <Select
                value={pick}
                options={[
                  ['set', 'Pick the color'],
                  ['add', 'Add a color'],
                  ['sub', 'Remove a color'],
                ]}
                onChange={setPick}
              />
              <div style={{ display: 'flex', gap: 3, marginTop: 8, flexWrap: 'wrap' }}>
                {samples.map((c, i) => (
                  <span key={i} className="lp-swatch" style={{ width: 16, height: 16, background: `rgb(${c.map((v) => Math.round(v * 255)).join(',')})` }} />
                ))}
              </div>
            </>
          )}
          <div style={{ height: 10 }} />
          <Select
            value={show}
            options={[
              ['selection', 'Show Selection'],
              ['image', 'Show Image'],
            ]}
            onChange={setShow}
          />
        </div>
        <div className="lp-preview-box" style={{ flex: 1, height: 280 }}>
          <canvas
            ref={canvas}
            style={{ cursor: 'crosshair' }}
            onPointerDown={(e) => {
              if (!src) return;
              const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
              const x = Math.floor(((e.clientX - r.left) / r.width) * src.w),
                y = Math.floor(((e.clientY - r.top) / r.height) * src.h);
              const i = (y * src.w + x) * 4;
              const c: RGB = [src.data[i]!, src.data[i + 1]!, src.data[i + 2]!];
              setMode('sampled');
              const p = e.shiftKey ? 'add' : e.altKey ? 'sub' : pick;
              if (p === 'set') setSamples([c]);
              else if (p === 'add') setSamples([...samples, c]);
              else setSamples(samples.length > 1 ? samples.filter((s) => Math.abs(s[0] - c[0]) + Math.abs(s[1] - c[1]) + Math.abs(s[2] - c[2]) > 0.12) : samples);
            }}
          />
        </div>
      </div>
    </Dialog>
  );
}
