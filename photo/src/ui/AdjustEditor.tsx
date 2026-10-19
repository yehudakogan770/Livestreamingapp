// The settings of each adjustment: used by the Properties panel (adjustment
// layers) and by Image ▸ Adjustments (on the pixels). Curves and Levels show
// the histogram of what they change.

import { useEffect, useRef, useState } from 'react';
import { defaultParams, curveTable, SELECTIVE_RANGES, parseCube, type AdjustmentType, type AdjustmentParams, type ParamsMap, type CurvePoints, type LevelsChannel } from '../core/adjust';
import { GRADIENT_PRESETS } from '../core/gradient';
import { Slider, Select, Check, ColorWell } from './fields';
import { openDialog, toast } from '../app/state';
import { gradientCss } from './util';
import { getHost } from '../app/host';

type Ch = 'rgb' | 'r' | 'g' | 'b';
const CH_OPTS: [Ch, string][] = [
  ['rgb', 'RGB'],
  ['r', 'Red'],
  ['g', 'Green'],
  ['b', 'Blue'],
];

export function AdjustEditor({ type, params, onChange, hist }: { type: AdjustmentType; params: AdjustmentParams; onChange: (p: AdjustmentParams, final: boolean) => void; hist?: Uint32Array[] | null }) {
  const set = <T extends AdjustmentType>(patch: Partial<ParamsMap[T]>, final = false) => onChange({ ...(params as object), ...patch } as unknown as AdjustmentParams, final);
  switch (type) {
    case 'brightnessContrast': {
      const p = params as ParamsMap['brightnessContrast'];
      return (
        <>
          <Slider label="Brightness" value={p.brightness} min={p.legacy ? -100 : -150} max={p.legacy ? 100 : 150} onChange={(v) => set({ brightness: v })} onCommit={(v) => set({ brightness: v }, true)} />
          <Slider label="Contrast" value={p.contrast} min={p.legacy ? -100 : -50} max={100} onChange={(v) => set({ contrast: v })} onCommit={(v) => set({ contrast: v }, true)} />
          <Check label="Use Legacy" checked={p.legacy} onChange={(v) => set({ legacy: v }, true)} />
        </>
      );
    }
    case 'levels':
      return <LevelsEditor p={params as ParamsMap['levels']} onChange={(p, f) => onChange(p, f)} hist={hist} />;
    case 'curves':
      return <CurvesEditor p={params as ParamsMap['curves']} onChange={(p, f) => onChange(p, f)} hist={hist} />;
    case 'exposure': {
      const p = params as ParamsMap['exposure'];
      return (
        <>
          <Slider label="Exposure" value={p.exposure} min={-20} max={20} step={0.01} digits={2} onChange={(v) => set({ exposure: v })} onCommit={(v) => set({ exposure: v }, true)} />
          <Slider label="Offset" value={p.offset} min={-0.5} max={0.5} step={0.0001} digits={4} onChange={(v) => set({ offset: v })} onCommit={(v) => set({ offset: v }, true)} />
          <Slider label="Gamma Correction" value={p.gamma} min={0.01} max={9.99} step={0.01} digits={2} onChange={(v) => set({ gamma: v })} onCommit={(v) => set({ gamma: v }, true)} />
        </>
      );
    }
    case 'vibrance': {
      const p = params as ParamsMap['vibrance'];
      return (
        <>
          <Slider label="Vibrance" value={p.vibrance} min={-100} max={100} onChange={(v) => set({ vibrance: v })} onCommit={(v) => set({ vibrance: v }, true)} />
          <Slider label="Saturation" value={p.saturation} min={-100} max={100} onChange={(v) => set({ saturation: v })} onCommit={(v) => set({ saturation: v }, true)} />
        </>
      );
    }
    case 'hueSaturation':
      return <HueSatEditor p={params as ParamsMap['hueSaturation']} onChange={(p, f) => onChange(p, f)} />;
    case 'colorBalance':
      return <ColorBalanceEditor p={params as ParamsMap['colorBalance']} onChange={(p, f) => onChange(p, f)} />;
    case 'blackWhite': {
      const p = params as ParamsMap['blackWhite'];
      const keys = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const;
      return (
        <>
          <Check label="Tint" checked={p.tint} onChange={(v) => set({ tint: v }, true)} />
          {p.tint && (
            <>
              <Slider label="Tint Hue" value={p.tintHue} min={0} max={360} onChange={(v) => set({ tintHue: v })} onCommit={(v) => set({ tintHue: v }, true)} />
              <Slider label="Tint Saturation" value={p.tintSat} min={0} max={100} onChange={(v) => set({ tintSat: v })} onCommit={(v) => set({ tintSat: v }, true)} />
            </>
          )}
          {keys.map((k) => (
            <Slider key={k} label={k[0]!.toUpperCase() + k.slice(1)} value={p[k]} min={-200} max={300} suffix="%" onChange={(v) => set({ [k]: v })} onCommit={(v) => set({ [k]: v }, true)} />
          ))}
          <button className="lp-btn" onClick={() => onChange(defaultParams('blackWhite'), true)}>
            Default
          </button>
        </>
      );
    }
    case 'photoFilter': {
      const p = params as ParamsMap['photoFilter'];
      const presets: [string, [number, number, number]][] = [
        ['Warming Filter (85)', [0.925, 0.541, 0]],
        ['Warming Filter (LBA)', [0.98, 0.588, 0]],
        ['Warming Filter (81)', [0.922, 0.694, 0.075]],
        ['Cooling Filter (80)', [0, 0.427, 1]],
        ['Cooling Filter (LBB)', [0, 0.365, 1]],
        ['Cooling Filter (82)', [0, 0.71, 1]],
        ['Sepia', [0.675, 0.478, 0.2]],
        ['Underwater', [0, 0.761, 0.694]],
      ];
      const cur = presets.find(([, c]) => c.every((v, i) => Math.abs(v - p.color[i]!) < 0.002));
      return (
        <>
          <div className="lp-panel-row">
            <Select label="Filter" value={cur?.[0] ?? 'custom'} options={[...presets.map(([n]) => [n, n] as [string, string]), ['custom', 'Custom']]} onChange={(v) => {
              const pr = presets.find(([n]) => n === v);
              if (pr) set({ color: pr[1] }, true);
            }} />
            <ColorWell color={p.color} title="Filter color" onClick={() => openDialog('colorPicker', { color: p.color, onPick: (c: [number, number, number]) => set({ color: c }, true) })} />
          </div>
          <Slider label="Density" value={p.density} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={(v) => set({ density: v })} onCommit={(v) => set({ density: v }, true)} />
          <Check label="Preserve Luminosity" checked={p.preserve} onChange={(v) => set({ preserve: v }, true)} />
        </>
      );
    }
    case 'channelMixer':
      return <ChannelMixerEditor p={params as ParamsMap['channelMixer']} onChange={(p, f) => onChange(p, f)} />;
    case 'colorLookup': {
      const p = params as ParamsMap['colorLookup'];
      return (
        <>
          <div className="lp-panel-row">
            <span className="lp-label">3D LUT</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.lut ? p.lut.name : 'None'}</span>
          </div>
          <button
            className="lp-btn"
            onClick={async () => {
              const files = await getHost().openFiles([{ name: '3D LUT (.cube)', extensions: ['cube'] }], false);
              const f = files[0];
              if (!f) return;
              try {
                onChange({ lut: parseCube(new TextDecoder().decode(f.bytes), f.name.replace(/\.[^.]+$/, '')) }, true);
              } catch (e) {
                toast(e instanceof Error ? e.message : String(e), 'error');
              }
            }}
          >
            Load 3D LUT…
          </button>
          {p.lut && (
            <button className="lp-btn" style={{ marginLeft: 6 }} onClick={() => onChange({ lut: null }, true)}>
              Remove
            </button>
          )}
        </>
      );
    }
    case 'invert':
      return <div className="lp-note">Invert has no settings.</div>;
    case 'posterize': {
      const p = params as ParamsMap['posterize'];
      return <Slider label="Levels" value={p.levels} min={2} max={255} onChange={(v) => set({ levels: v })} onCommit={(v) => set({ levels: v }, true)} />;
    }
    case 'threshold': {
      const p = params as ParamsMap['threshold'];
      return (
        <>
          {hist && <HistogramCanvas hist={hist} channel="rgb" marks={[p.level / 255]} />}
          <Slider label="Threshold Level" value={p.level} min={1} max={255} onChange={(v) => set({ level: v })} onCommit={(v) => set({ level: v }, true)} />
        </>
      );
    }
    case 'gradientMap': {
      const p = params as ParamsMap['gradientMap'];
      return (
        <>
          <div className="lp-gradient-bar" style={{ background: gradientCss(p.gradient, p.reverse), cursor: 'pointer', marginBottom: 8 }} onClick={() => openDialog('gradientEditor', { gradient: p.gradient, onPick: (g: typeof p.gradient) => set({ gradient: g }, true) })} title="Edit the gradient" />
          <Select label="Preset" value={GRADIENT_PRESETS.findIndex((g) => g.name === p.gradient.name)} options={[[-1, 'Custom'] as [number, string], ...GRADIENT_PRESETS.map((g, i) => [i, g.name] as [number, string])]} onChange={(i) => i >= 0 && set({ gradient: structuredClone(GRADIENT_PRESETS[i]!) }, true)} />
          <div style={{ height: 6 }} />
          <Check label="Reverse" checked={p.reverse} onChange={(v) => set({ reverse: v }, true)} />
        </>
      );
    }
    case 'selectiveColor':
      return <SelectiveEditor p={params as ParamsMap['selectiveColor']} onChange={(p, f) => onChange(p, f)} />;
  }
}

// ---- histogram ----

export function HistogramCanvas({ hist, channel, marks = [], height = 90 }: { hist: Uint32Array[]; channel: Ch | 'colors'; marks?: number[]; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 256;
    c.width = w * dpr;
    c.height = height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, height);
    const draw = (h: Uint32Array, color: string) => {
      let max = 1;
      // Ignore the two ends when scaling (clipped pixels pile up there).
      for (let i = 1; i < h.length - 1; i++) max = Math.max(max, h[i]!);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let i = 0; i < h.length; i++) ctx.lineTo((i / (h.length - 1)) * w, height - Math.min(1, h[i]! / max) * (height - 2));
      ctx.lineTo(w, height);
      ctx.closePath();
      ctx.fill();
    };
    const idx = { rgb: 3, r: 0, g: 1, b: 2 } as const;
    if (channel === 'colors') {
      ctx.globalCompositeOperation = 'lighter';
      draw(hist[0]!, 'rgba(220,60,60,0.75)');
      draw(hist[1]!, 'rgba(60,200,80,0.75)');
      draw(hist[2]!, 'rgba(70,110,240,0.75)');
      ctx.globalCompositeOperation = 'source-over';
    } else draw(hist[idx[channel]] ?? hist[0]!, channel === 'rgb' ? 'rgba(160,160,160,0.85)' : channel === 'r' ? 'rgba(220,70,70,0.85)' : channel === 'g' ? 'rgba(70,190,90,0.85)' : 'rgba(80,120,230,0.85)');
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    for (const m of marks) {
      ctx.beginPath();
      ctx.moveTo(Math.round(m * w) + 0.5, 0);
      ctx.lineTo(Math.round(m * w) + 0.5, height);
      ctx.stroke();
    }
  }, [hist, channel, marks, height]);
  return <canvas ref={ref} className="lp-histogram" style={{ height }} />;
}

// ---- Levels ----

function LevelsEditor({ p, onChange, hist }: { p: ParamsMap['levels']; onChange: (p: ParamsMap['levels'], final: boolean) => void; hist?: Uint32Array[] | null }) {
  const [ch, setCh] = useState<Ch>('rgb');
  const c = p[ch];
  const set = (patch: Partial<LevelsChannel>, final = false) => onChange({ ...p, [ch]: { ...c, ...patch } }, final);
  return (
    <>
      <div className="lp-panel-row">
        <Select value={ch} options={CH_OPTS} onChange={setCh} title="Channel" />
        <span style={{ flex: 1 }} />
        <button className="lp-btn" onClick={() => window.dispatchEvent(new CustomEvent('lp-auto-levels'))}>
          Auto
        </button>
      </div>
      {hist && <HistogramCanvas hist={hist} channel={ch} marks={[c.inBlack, c.inWhite]} />}
      <Slider label="Input Black" value={Math.round(c.inBlack * 255)} min={0} max={253} onChange={(v) => set({ inBlack: Math.min(v / 255, c.inWhite - 2 / 255) })} onCommit={(v) => set({ inBlack: Math.min(v / 255, c.inWhite - 2 / 255) }, true)} />
      <Slider label="Gamma" value={c.gamma} min={0.1} max={9.99} step={0.01} digits={2} onChange={(v) => set({ gamma: v })} onCommit={(v) => set({ gamma: v }, true)} />
      <Slider label="Input White" value={Math.round(c.inWhite * 255)} min={2} max={255} onChange={(v) => set({ inWhite: Math.max(v / 255, c.inBlack + 2 / 255) })} onCommit={(v) => set({ inWhite: Math.max(v / 255, c.inBlack + 2 / 255) }, true)} />
      <Slider label="Output Black" value={Math.round(c.outBlack * 255)} min={0} max={255} onChange={(v) => set({ outBlack: v / 255 })} onCommit={(v) => set({ outBlack: v / 255 }, true)} />
      <Slider label="Output White" value={Math.round(c.outWhite * 255)} min={0} max={255} onChange={(v) => set({ outWhite: v / 255 })} onCommit={(v) => set({ outWhite: v / 255 }, true)} />
    </>
  );
}

// ---- Curves ----

function CurvesEditor({ p, onChange, hist }: { p: ParamsMap['curves']; onChange: (p: ParamsMap['curves'], final: boolean) => void; hist?: Uint32Array[] | null }) {
  const [ch, setCh] = useState<Ch>('rgb');
  const [sel, setSel] = useState<number | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const pts = p[ch];
  const drag = useRef<{ i: number; moved: boolean } | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth;
    c.width = W * dpr;
    c.height = W * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, W);
    // Histogram behind.
    if (hist) {
      const h = hist[{ rgb: 3, r: 0, g: 1, b: 2 }[ch]] ?? hist[0]!;
      let max = 1;
      for (let i = 1; i < h.length - 1; i++) max = Math.max(max, h[i]!);
      ctx.fillStyle = 'rgba(128,128,128,0.28)';
      ctx.beginPath();
      ctx.moveTo(0, W);
      for (let i = 0; i < h.length; i++) ctx.lineTo((i / (h.length - 1)) * W, W - Math.min(1, h[i]! / max) * W * 0.95);
      ctx.lineTo(W, W);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(128,128,128,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      ctx.moveTo(Math.round((i * W) / 4) + 0.5, 0);
      ctx.lineTo(Math.round((i * W) / 4) + 0.5, W);
      ctx.moveTo(0, Math.round((i * W) / 4) + 0.5);
      ctx.lineTo(W, Math.round((i * W) / 4) + 0.5);
    }
    ctx.moveTo(0, W);
    ctx.lineTo(W, 0);
    ctx.stroke();
    // Other channels faintly.
    const color = { rgb: '#e8e8e8', r: '#e05050', g: '#50c060', b: '#5080e0' };
    const curve = (list: CurvePoints, stroke: string, width: number) => {
      const t = curveTable(list, 256);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * W,
          y = W - t[i]! * W;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    if (ch === 'rgb') for (const k of ['r', 'g', 'b'] as const) if (p[k].length > 2 || p[k][0]![1] !== 0 || p[k][1]![1] !== 1) curve(p[k], color[k] + '88', 1);
    curve(pts, getComputedStyle(c).getPropertyValue('--text') || color[ch], 1.5);
    pts.forEach(([x, y], i) => {
      ctx.fillStyle = i === sel ? '#ffffff' : 'transparent';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.rect(x * W - 4, W - y * W - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    });
  }, [p, ch, sel, hist, pts]);

  const at = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };
  const setPts = (list: CurvePoints, final: boolean) => onChange({ ...p, [ch]: list }, final);

  return (
    <>
      <div className="lp-panel-row">
        <Select value={ch} options={CH_OPTS} onChange={(v) => {
          setCh(v);
          setSel(null);
        }} title="Channel" />
        <span style={{ flex: 1 }} />
        <button className="lp-btn" onClick={() => window.dispatchEvent(new CustomEvent('lp-auto-levels'))}>
          Auto
        </button>
        <button className="lp-btn" onClick={() => setPts([[0, 0], [1, 1]], true)}>
          Reset
        </button>
      </div>
      <canvas
        ref={ref}
        className="lp-curves"
        aria-label="Curve: click to add a point, drag to move, drag out to remove"
        onPointerDown={(e) => {
          const [x, y] = at(e);
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          let i = pts.findIndex(([px, py]) => Math.abs(px - x) < 0.03 && Math.abs(py - y) < 0.05);
          if (i < 0) {
            const list = [...pts, [x, y] as [number, number]].sort((a, b) => a[0] - b[0]);
            i = list.findIndex((q) => q[0] === x && q[1] === y);
            setPts(list, false);
          }
          setSel(i);
          drag.current = { i, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const [x, y] = at(e);
          const list = pts.map((q) => [...q] as [number, number]);
          const lo = d.i > 0 ? list[d.i - 1]![0] + 0.01 : 0,
            hi = d.i < list.length - 1 ? list[d.i + 1]![0] - 0.01 : 1;
          const r = ref.current!.getBoundingClientRect();
          const out = e.clientY > r.bottom + 20 || e.clientY < r.top - 20 || e.clientX < r.left - 20 || e.clientX > r.right + 20;
          if (out && list.length > 2) {
            list.splice(d.i, 1);
            drag.current = null;
            setSel(null);
            setPts(list, true);
            return;
          }
          list[d.i] = [Math.min(hi, Math.max(lo, x)), y];
          d.moved = true;
          setPts(list, false);
        }}
        onPointerUp={() => {
          if (drag.current) setPts(pts, true);
          drag.current = null;
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && sel !== null && pts.length > 2) {
            e.stopPropagation();
            setPts(pts.filter((_, i) => i !== sel), true);
            setSel(null);
          }
        }}
        tabIndex={0}
      />
      {sel !== null && pts[sel] && (
        <div className="lp-panel-row" style={{ marginTop: 6 }}>
          <span className="lp-label">Input {Math.round(pts[sel][0] * 255)}</span>
          <span className="lp-label">Output {Math.round(pts[sel][1] * 255)}</span>
        </div>
      )}
    </>
  );
}

// ---- Hue/Saturation ----

function HueSatEditor({ p, onChange }: { p: ParamsMap['hueSaturation']; onChange: (p: ParamsMap['hueSaturation'], final: boolean) => void }) {
  const [range, setRange] = useState<'master' | keyof ParamsMap['hueSaturation']['ranges']>('master');
  const cur = range === 'master' ? p.master : p.ranges[range];
  const set = (patch: Partial<{ hue: number; sat: number; light: number }>, final = false) => {
    if (range === 'master') onChange({ ...p, master: { ...p.master, ...patch } }, final);
    else onChange({ ...p, ranges: { ...p.ranges, [range]: { ...p.ranges[range], ...patch } } }, final);
  };
  if (p.colorize)
    return (
      <>
        <Check label="Colorize" checked onChange={(v) => onChange({ ...p, colorize: v }, true)} />
        <Slider label="Hue" value={p.colorizeHue} min={0} max={360} onChange={(v) => onChange({ ...p, colorizeHue: v }, false)} onCommit={(v) => onChange({ ...p, colorizeHue: v }, true)} />
        <Slider label="Saturation" value={p.colorizeSat} min={0} max={100} onChange={(v) => onChange({ ...p, colorizeSat: v }, false)} onCommit={(v) => onChange({ ...p, colorizeSat: v }, true)} />
        <Slider label="Lightness" value={p.colorizeLight} min={-100} max={100} onChange={(v) => onChange({ ...p, colorizeLight: v }, false)} onCommit={(v) => onChange({ ...p, colorizeLight: v }, true)} />
      </>
    );
  return (
    <>
      <div className="lp-panel-row">
        <Select
          value={range}
          title="Range"
          options={[
            ['master', 'Master'],
            ['reds', 'Reds'],
            ['yellows', 'Yellows'],
            ['greens', 'Greens'],
            ['cyans', 'Cyans'],
            ['blues', 'Blues'],
            ['magentas', 'Magentas'],
          ]}
          onChange={setRange}
        />
      </div>
      <Slider label="Hue" value={cur.hue} min={-180} max={180} onChange={(v) => set({ hue: v })} onCommit={(v) => set({ hue: v }, true)} />
      <Slider label="Saturation" value={cur.sat} min={-100} max={100} onChange={(v) => set({ sat: v })} onCommit={(v) => set({ sat: v }, true)} />
      <Slider label="Lightness" value={cur.light} min={-100} max={100} onChange={(v) => set({ light: v })} onCommit={(v) => set({ light: v }, true)} />
      <Check label="Colorize" checked={false} onChange={(v) => onChange({ ...p, colorize: v }, true)} />
    </>
  );
}

function ColorBalanceEditor({ p, onChange }: { p: ParamsMap['colorBalance']; onChange: (p: ParamsMap['colorBalance'], final: boolean) => void }) {
  const [tone, setTone] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');
  const v = p[tone];
  const set = (i: number, x: number, final: boolean) => {
    const n = [...v] as [number, number, number];
    n[i] = x;
    onChange({ ...p, [tone]: n }, final);
  };
  const names: [string, string][] = [
    ['Cyan', 'Red'],
    ['Magenta', 'Green'],
    ['Yellow', 'Blue'],
  ];
  return (
    <>
      <div className="lp-panel-row">
        <Select
          value={tone}
          title="Tone"
          options={[
            ['shadows', 'Shadows'],
            ['midtones', 'Midtones'],
            ['highlights', 'Highlights'],
          ]}
          onChange={setTone}
        />
      </div>
      {names.map(([a, b], i) => (
        <Slider key={a} label={`${a} – ${b}`} value={v[i]!} min={-100} max={100} onChange={(x) => set(i, x, false)} onCommit={(x) => set(i, x, true)} />
      ))}
      <Check label="Preserve Luminosity" checked={p.preserve} onChange={(x) => onChange({ ...p, preserve: x }, true)} />
    </>
  );
}

function ChannelMixerEditor({ p, onChange }: { p: ParamsMap['channelMixer']; onChange: (p: ParamsMap['channelMixer'], final: boolean) => void }) {
  const [out, setOut] = useState<'r' | 'g' | 'b'>('r');
  const v = p[out];
  const set = (i: number, x: number, final: boolean) => {
    const n = [...v] as [number, number, number, number];
    n[i] = x;
    onChange(p.mono ? { ...p, r: n, g: n, b: n } : { ...p, [out]: n }, final);
  };
  const total = v[0] + v[1] + v[2];
  return (
    <>
      <div className="lp-panel-row">
        <Select
          value={out}
          title="Output channel"
          options={
            p.mono
              ? [['r', 'Gray']]
              : [
                  ['r', 'Red'],
                  ['g', 'Green'],
                  ['b', 'Blue'],
                ]
          }
          onChange={setOut}
        />
        <Check label="Monochrome" checked={p.mono} onChange={(m) => onChange(m ? { ...p, mono: true, r: [40, 40, 20, 0], g: [40, 40, 20, 0], b: [40, 40, 20, 0] } : { ...p, mono: false }, true)} />
      </div>
      {['Red', 'Green', 'Blue', 'Constant'].map((n, i) => (
        <Slider key={n} label={n} value={v[i]!} min={-200} max={200} suffix="%" onChange={(x) => set(i, x, false)} onCommit={(x) => set(i, x, true)} />
      ))}
      <div className={`lp-note${total > 100 ? ' lp-warning' : ''}`}>Total: {total > 0 ? '+' : ''}{total}%</div>
    </>
  );
}

function SelectiveEditor({ p, onChange }: { p: ParamsMap['selectiveColor']; onChange: (p: ParamsMap['selectiveColor'], final: boolean) => void }) {
  const [r, setR] = useState<(typeof SELECTIVE_RANGES)[number]>('reds');
  const v = p.ranges[r];
  const set = (k: 'c' | 'm' | 'y' | 'k', x: number, final: boolean) => onChange({ ...p, ranges: { ...p.ranges, [r]: { ...v, [k]: x } } }, final);
  return (
    <>
      <div className="lp-panel-row">
        <Select value={r} title="Colors" options={SELECTIVE_RANGES.map((x) => [x, x[0]!.toUpperCase() + x.slice(1)] as [typeof x, string])} onChange={setR} />
      </div>
      {(
        [
          ['c', 'Cyan'],
          ['m', 'Magenta'],
          ['y', 'Yellow'],
          ['k', 'Black'],
        ] as const
      ).map(([k, n]) => (
        <Slider key={k} label={n} value={v[k]} min={-100} max={100} suffix="%" onChange={(x) => set(k, x, false)} onCommit={(x) => set(k, x, true)} />
      ))}
      <div className="lp-panel-row">
        <label className="lp-check-label">
          <input type="radio" checked={p.relative} onChange={() => onChange({ ...p, relative: true }, true)} /> Relative
        </label>
        <label className="lp-check-label">
          <input type="radio" checked={!p.relative} onChange={() => onChange({ ...p, relative: false }, true)} /> Absolute
        </label>
      </div>
    </>
  );
}
