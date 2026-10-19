// Brushes: presets (built in and saved), and the tip's settings — size,
// hardness, spacing, angle, roundness, scattering, pen pressure, texture.
// The same settings appear in the Brush Settings dialog.

import { useEffect, useRef } from 'react';
import { app, setOpts, useApp } from '../../app/state';
import { defaultTip, type ToolId, type ToolOptions, type BrushTip } from '../../app/toolDefs';
import { dabCoverage } from '../../core/brush';
import { Slider, Check, Select } from '../fields';
import { allPatterns } from '../../core/patterns';

type TipKey =
  | 'brush'
  | 'pencil'
  | 'eraser'
  | 'bgEraser'
  | 'mixer'
  | 'colorReplace'
  | 'clone'
  | 'pattern'
  | 'history'
  | 'heal'
  | 'spot'
  | 'remove'
  | 'focus'
  | 'tone';

export const TIP_KEY: Partial<Record<ToolId, TipKey>> = {
  brush: 'brush',
  pencil: 'pencil',
  eraser: 'eraser',
  bgEraser: 'bgEraser',
  mixer: 'mixer',
  colorReplace: 'colorReplace',
  clone: 'clone',
  patternStamp: 'pattern',
  historyBrush: 'history',
  heal: 'heal',
  spotHeal: 'spot',
  removeTool: 'remove',
  blur: 'focus',
  sharpen: 'focus',
  smudge: 'focus',
  dodge: 'tone',
  burn: 'tone',
  sponge: 'tone',
};

const PRESETS: { name: string; tip: Partial<BrushTip> }[] = [
  { name: 'Soft Round', tip: { hardness: 0 } },
  { name: 'Hard Round', tip: { hardness: 1 } },
  { name: 'Soft Edge', tip: { hardness: 0.5 } },
  { name: 'Chalk', tip: { hardness: 0.8, texture: 'paper', textureDepth: 0.7, scatter: 0.05 } },
  { name: 'Spatter', tip: { hardness: 0.9, size: 40, scatter: 1.2, count: 3, sizeJitter: 0.7, spacing: 0.5 } },
  { name: 'Flat Angle', tip: { hardness: 0.9, roundness: 0.25, angle: 45 } },
  { name: 'Dry Media', tip: { hardness: 0.7, texture: 'canvas', textureDepth: 0.6, spacing: 0.1 } },
  { name: 'Airy', tip: { hardness: 0, spacing: 0.1, scatter: 0.3, sizeJitter: 0.3 } },
];

function TipPreview({ tip, size = 44 }: { tip: BrushTip; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    const im = ctx.createImageData(size, size);
    const d = size * 0.8;
    const t = { ...tip, size: d };
    const dab = { x: 0, y: 0, size: d, angle: tip.angle, roundness: tip.roundness, flow: 1, cap: 1 };
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const a = dabCoverage(t, dab, x + 0.5 - size / 2, y + 0.5 - size / 2);
        const o = (y * size + x) * 4;
        im.data[o] = im.data[o + 1] = im.data[o + 2] = 230;
        im.data[o + 3] = Math.round(Math.min(1, a) * 255);
      }
    ctx.putImageData(im, 0, 0);
  }, [tip, size]);
  return <canvas ref={ref} style={{ width: size / 1.4, height: size / 1.4 }} />;
}

export function BrushSettings() {
  const tool = useApp((s) => s.tool);
  const opts = useApp((s) => s.opts);
  const presets = useApp((s) => s.brushPresets);
  const k = TIP_KEY[tool] ?? 'brush';
  const tip = (opts[k] as { tip: BrushTip }).tip;
  const set = (patch: Partial<BrushTip>) => setOpts(k, { tip: { ...tip, ...patch } } as Partial<ToolOptions[typeof k]>);
  return (
    <>
      {!TIP_KEY[tool] && (
        <div className="lp-note" style={{ marginBottom: 8 }}>
          Showing the Brush tool’s tip. Pick a painting tool to change its own.
        </div>
      )}
      <div className="lp-brushes">
        {PRESETS.map((p) => {
          const t = { ...defaultTip(tip.size, 0), ...p.tip, size: tip.size };
          const on = Object.entries(p.tip).every(([key, v]) => key === 'size' || (tip as unknown as Record<string, unknown>)[key] === v);
          return (
            <button
              key={p.name}
              aria-pressed={on}
              title={p.name}
              onClick={() => set({ ...defaultTip(tip.size, 0), ...p.tip, size: p.tip.size ?? tip.size, pressureSize: tip.pressureSize })}
            >
              <TipPreview tip={t} />
              <span>{p.name}</span>
            </button>
          );
        })}
        {presets.map((p, i) => (
          <button
            key={`u${i}`}
            title={`${p.name} (Alt+click to delete)`}
            onClick={(e) => {
              if (e.altKey) app.set((s) => ({ brushPresets: s.brushPresets.filter((_, j) => j !== i) }));
              else set(p.tip);
            }}
          >
            <TipPreview tip={p.tip} />
            <span>{p.name}</span>
          </button>
        ))}
      </div>
      <div className="lp-section-title">Tip</div>
      <Slider label="Size" value={tip.size} min={1} max={2500} suffix="px" onChange={(v) => set({ size: v })} />
      <Slider label="Hardness" value={tip.hardness} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={(v) => set({ hardness: v })} />
      <Slider label="Spacing" value={tip.spacing} min={0.01} max={10} step={0.01} scale={100} suffix="%" onChange={(v) => set({ spacing: v })} />
      <Slider label="Angle" value={tip.angle} min={-180} max={180} suffix="°" onChange={(v) => set({ angle: v })} />
      <Slider label="Roundness" value={tip.roundness} min={0.01} max={1} step={0.01} scale={100} suffix="%" onChange={(v) => set({ roundness: v })} />
      <div className="lp-section-title">Shape Dynamics and Scattering</div>
      <Slider label="Size Jitter" value={tip.sizeJitter} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={(v) => set({ sizeJitter: v })} />
      <Slider label="Angle Jitter" value={tip.angleJitter} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={(v) => set({ angleJitter: v })} />
      <Slider label="Scatter" value={tip.scatter} min={0} max={10} step={0.01} scale={100} suffix="%" onChange={(v) => set({ scatter: v })} />
      <Slider label="Count" value={tip.count} min={1} max={16} onChange={(v) => set({ count: v })} />
      <div className="lp-section-title">Pen Pressure</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Check label="Size" checked={tip.pressureSize} onChange={(v) => set({ pressureSize: v })} />
        <Check label="Opacity" checked={tip.pressureOpacity} onChange={(v) => set({ pressureOpacity: v })} />
        <Check label="Flow" checked={tip.pressureFlow} onChange={(v) => set({ pressureFlow: v })} />
      </div>
      <div className="lp-section-title">Texture</div>
      <div className="lp-panel-row">
        <Select
          value={tip.texture ?? ''}
          options={[['', 'None'] as [string, string], ...allPatterns().map((p) => [p.id, p.name] as [string, string])]}
          onChange={(v) => set({ texture: v || null })}
          title="Texture"
        />
      </div>
      {tip.texture && (
        <>
          <Slider label="Depth" value={tip.textureDepth} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={(v) => set({ textureDepth: v })} />
          <Slider label="Scale" value={tip.textureScale} min={0.1} max={10} step={0.01} scale={100} suffix="%" onChange={(v) => set({ textureScale: v })} />
        </>
      )}
      <div className="lp-section-title">Dual Brush</div>
      <div className="lp-panel-row">
        <Check
          label="A second tip shapes the first"
          checked={!!tip.dual}
          onChange={(v) => set({ dual: v ? { size: Math.max(2, Math.round(tip.size * 0.4)), spacing: 0.3, scatter: 0.6 } : null })}
        />
      </div>
      {tip.dual && (
        <>
          <Slider label="Second Tip Size" value={tip.dual.size} min={1} max={1000} suffix="px" onChange={(v) => set({ dual: { ...tip.dual!, size: v } })} />
          <Slider
            label="Second Tip Scatter"
            value={tip.dual.scatter}
            min={0}
            max={5}
            step={0.01}
            scale={100}
            suffix="%"
            onChange={(v) => set({ dual: { ...tip.dual!, scatter: v } })}
          />
        </>
      )}
      <div className="lp-section-title">Smoothing</div>
      <Slider label="Smoothing" value={tip.smoothing} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={(v) => set({ smoothing: v })} />
    </>
  );
}

export function BrushesPanel() {
  return (
    <div className="lp-panel">
      <BrushSettings />
    </div>
  );
}
