// Workspaces that take over the window: Camera Raw, Select and Mask, and
// Liquify. Each edits a reduced copy live and applies at full size on OK.

import { useEffect, useMemo, useRef, useState } from 'react';
import { app, current, useApp, busy, bump, toast } from '../../app/state';
import { run } from '../../app/commands';
import { Slider, Select, Check, OkCancel } from '../fields';
import { defaultDevelop, HSL_COLORS, type DevelopParams } from '../../core/filters/develop';
import { runFilterAsync } from '../../app/workers';
import { workRect, canvasRect, selectionMask, withSelection, change } from '../../app/ops/common';
import { refineEdge, maskToRaster, type Mask } from '../../core/selection';
import { sampleSource } from '../../app/tools/selectTools';
import { displace } from '../../core/warp';
import { resize, type Img } from '../../core/img';
import { TileEdit, Raster } from '../../core/raster';
import { pixelLayer, insertLayers, updateLayer, nextName } from '../../core/layers';
import { encode as encodeTrc } from '../../core/color';

const MAX = 1400;

/** A reduced copy of an RGBA float picture. */
function reduce(src: Img, max = MAX): { img: Img; k: number } {
  const k = Math.min(1, max / Math.max(src.w, src.h));
  if (k >= 1) return { img: src, k: 1 };
  return { img: resize(src, Math.max(1, Math.round(src.w * k)), Math.max(1, Math.round(src.h * k)), 'bilinear'), k };
}

function drawImg(c: HTMLCanvasElement | null, im: Img, linear = false, trc = { type: 'srgb' as const }): void {
  if (!c) return;
  c.width = im.w;
  c.height = im.h;
  const ctx = c.getContext('2d')!;
  const out = ctx.createImageData(im.w, im.h);
  for (let i = 0; i < im.w * im.h; i++) {
    const a = im.data[i * 4 + 3]!;
    const ch = (((i % im.w) >> 3) + (Math.floor(i / im.w) >> 3)) & 1 ? 0.8 : 1;
    for (let k = 0; k < 3; k++) {
      let v = Math.min(1, Math.max(0, im.data[i * 4 + k]!));
      if (linear) v = encodeTrc(trc, v);
      out.data[i * 4 + k] = Math.round((v * a + ch * (1 - a)) * 255);
    }
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}

function Frame({
  title,
  children,
  side,
  onOk,
  onCancel,
  ok = 'OK',
}: {
  title: string;
  children: React.ReactNode;
  side: React.ReactNode;
  onOk: () => void;
  onCancel: () => void;
  ok?: string;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onOk();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onOk, onCancel]);
  return (
    <div className="lp-workspace" role="dialog" aria-label={title}>
      <div className="lp-menubar">
        <strong style={{ fontWeight: 600, padding: '0 8px' }}>{title}</strong>
        <span className="lp-spacer" />
        <OkCancel onOk={onOk} onCancel={onCancel} ok={ok} />
      </div>
      <div className="lp-workspace-body">
        <div className="lp-workspace-stage">{children}</div>
        <div className="lp-workspace-side">{side}</div>
      </div>
    </div>
  );
}

export function Workspaces() {
  const w = useApp((s) => s.workspace);
  const close = () => app.set({ workspace: null });
  if (!w || !current()) return null;
  if (w.kind === 'cameraRaw') return <CameraRaw onClose={close} />;
  if (w.kind === 'selectMask') return <SelectAndMask onClose={close} maskLayer={(w.props?.mask as string) ?? null} />;
  if (w.kind === 'liquify') return <Liquify onClose={close} />;
  return null;
}

// ---- Camera Raw ----

function CameraRaw({ onClose }: { onClose: () => void }) {
  const s = current()!;
  const l = s.activeLayer();
  const [p, setP] = useState<DevelopParams>(defaultDevelop);
  const [before, setBefore] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const src = useMemo(() => {
    const r = workRect(s.doc);
    const data = l && 'raster' in l ? l.raster.read(r) : new Float32Array(r.w * r.h * 4);
    return reduce({ w: r.w, h: r.h, c: 4, data });
  }, [s, l]);
  const tok = useRef(0);
  useEffect(() => {
    const t = ++tok.current;
    const id = window.setTimeout(async () => {
      if (before) return drawImg(canvas.current, src.img);
      try {
        const out = await runFilterAsync('cameraRaw', src.img, p as unknown as Record<string, unknown>, { width: src.img.w, height: src.img.h });
        if (t === tok.current) drawImg(canvas.current, out);
      } catch (e) {
        console.error(e);
      }
    }, 40);
    return () => clearTimeout(id);
  }, [p, before, src]);
  const set = (patch: Partial<DevelopParams>) => setP((cur) => ({ ...cur, ...patch }));
  const sl = (label: string, k: keyof DevelopParams, min = -100, max = 100, step = 1) => (
    <Slider
      key={k}
      label={label}
      value={p[k] as number}
      min={min}
      max={max}
      step={step}
      digits={step < 1 ? 2 : 0}
      onChange={(v) => set({ [k]: v } as Partial<DevelopParams>)}
    />
  );
  const [hslTab, setHslTab] = useState<'h' | 's' | 'l'>('s');
  const ok = () => {
    onClose();
    void run('filter.apply', { id: 'cameraRaw', params: p, label: 'Camera Raw Filter' });
  };
  return (
    <Frame
      title="Camera Raw"
      onOk={ok}
      onCancel={onClose}
      side={
        <>
          <div className="lp-panel-row">
            <Check label="Show original (before)" checked={before} onChange={setBefore} />
            <span style={{ flex: 1 }} />
            <button className="lp-btn" onClick={() => setP(defaultDevelop())}>
              Reset
            </button>
          </div>
          <div className="lp-section-title">White Balance</div>
          {sl('Temperature', 'temp')}
          {sl('Tint', 'tint')}
          <div className="lp-section-title">Tone</div>
          {sl('Exposure', 'exposure', -5, 5, 0.05)}
          {sl('Contrast', 'contrast')}
          {sl('Highlights', 'highlights')}
          {sl('Shadows', 'shadows')}
          {sl('Whites', 'whites')}
          {sl('Blacks', 'blacks')}
          <div className="lp-section-title">Presence</div>
          {sl('Texture', 'texture')}
          {sl('Clarity', 'clarity')}
          {sl('Dehaze', 'dehaze')}
          {sl('Vibrance', 'vibrance')}
          {sl('Saturation', 'saturation')}
          <div className="lp-section-title">Color Mixer</div>
          <div className="lp-panel-row">
            <Select
              value={hslTab}
              title="Adjust"
              options={[
                ['h', 'Hue'],
                ['s', 'Saturation'],
                ['l', 'Luminance'],
              ]}
              onChange={setHslTab}
            />
          </div>
          {HSL_COLORS.map((c) => (
            <Slider
              key={c}
              label={c[0]!.toUpperCase() + c.slice(1)}
              value={p.hsl[c][hslTab]}
              min={-100}
              max={100}
              onChange={(v) => set({ hsl: { ...p.hsl, [c]: { ...p.hsl[c], [hslTab]: v } } })}
            />
          ))}
          <div className="lp-section-title">Color Grading</div>
          {(['shadows', 'midtones', 'highlights'] as const).map((t) => (
            <div key={t}>
              <Slider
                label={`${t[0]!.toUpperCase() + t.slice(1)} Hue`}
                value={p.grade[t].hue}
                min={0}
                max={360}
                onChange={(v) => set({ grade: { ...p.grade, [t]: { ...p.grade[t], hue: v } } })}
              />
              <Slider
                label={`${t[0]!.toUpperCase() + t.slice(1)} Saturation`}
                value={p.grade[t].sat}
                min={0}
                max={100}
                onChange={(v) => set({ grade: { ...p.grade, [t]: { ...p.grade[t], sat: v } } })}
              />
            </div>
          ))}
          <Slider label="Blending" value={p.grade.blending} min={0} max={100} onChange={(v) => set({ grade: { ...p.grade, blending: v } })} />
          <Slider label="Balance" value={p.grade.balance} min={-100} max={100} onChange={(v) => set({ grade: { ...p.grade, balance: v } })} />
          <div className="lp-section-title">Detail</div>
          <Slider label="Sharpening" value={p.sharpen.amount} min={0} max={150} onChange={(v) => set({ sharpen: { ...p.sharpen, amount: v } })} />
          <Slider
            label="Radius"
            value={p.sharpen.radius}
            min={0.5}
            max={3}
            step={0.1}
            digits={1}
            onChange={(v) => set({ sharpen: { ...p.sharpen, radius: v } })}
          />
          <Slider label="Masking" value={p.sharpen.masking} min={0} max={100} onChange={(v) => set({ sharpen: { ...p.sharpen, masking: v } })} />
          <Slider label="Noise Reduction" value={p.noise.luminance} min={0} max={100} onChange={(v) => set({ noise: { ...p.noise, luminance: v } })} />
          <Slider label="Color Noise Reduction" value={p.noise.color} min={0} max={100} onChange={(v) => set({ noise: { ...p.noise, color: v } })} />
          <div className="lp-section-title">Optics</div>
          <Slider label="Distortion" value={p.lens.distortion} min={-100} max={100} onChange={(v) => set({ lens: { ...p.lens, distortion: v } })} />
          <Slider label="Lens Vignetting" value={p.lens.vignetting} min={-100} max={100} onChange={(v) => set({ lens: { ...p.lens, vignetting: v } })} />
          <Slider label="Defringe" value={p.lens.defringe} min={0} max={20} onChange={(v) => set({ lens: { ...p.lens, defringe: v } })} />
          <div className="lp-section-title">Effects</div>
          <Slider label="Vignette" value={p.effects.vignette} min={-100} max={100} onChange={(v) => set({ effects: { ...p.effects, vignette: v } })} />
          <Slider label="Midpoint" value={p.effects.midpoint} min={0} max={100} onChange={(v) => set({ effects: { ...p.effects, midpoint: v } })} />
          <Slider label="Feather" value={p.effects.feather} min={0} max={100} onChange={(v) => set({ effects: { ...p.effects, feather: v } })} />
          <Slider label="Grain" value={p.effects.grain} min={0} max={100} onChange={(v) => set({ effects: { ...p.effects, grain: v } })} />
          <Slider label="Grain Size" value={p.effects.grainSize} min={0} max={100} onChange={(v) => set({ effects: { ...p.effects, grainSize: v } })} />
        </>
      }
    >
      <canvas ref={canvas} />
    </Frame>
  );
}

// ---- Select and Mask ----

type View = 'onion' | 'black' | 'white' | 'bw' | 'overlay';

function SelectAndMask({ onClose, maskLayer }: { onClose: () => void; maskLayer: string | null }) {
  const s = current()!;
  const [view, setView] = useState<View>('onion');
  const [opacity, setOpacity] = useState(0.5);
  const [o, setO] = useState({ radius: 0, smooth: 0, feather: 0, contrast: 0, shiftEdge: 0 });
  const [output, setOutput] = useState<'selection' | 'mask' | 'layerMask'>(maskLayer ? 'mask' : 'selection');
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = useMemo(() => {
    const src = sampleSource(true)!;
    let m: Mask | null = null;
    if (maskLayer) {
      const l = s.activeLayer();
      if (l?.mask) {
        const r = l.mask.raster.read(canvasRect(s.doc), undefined, l.mask.background);
        const data = new Uint8Array(s.doc.width * s.doc.height);
        for (let i = 0; i < data.length; i++) data[i] = Math.round(r[i]! * 255);
        m = { w: s.doc.width, h: s.doc.height, data };
      }
    } else m = selectionMask(s.doc);
    if (!m) m = { w: s.doc.width, h: s.doc.height, data: new Uint8Array(s.doc.width * s.doc.height) };
    const small = reduce({ w: src.w, h: src.h, c: 4, data: src.data });
    const k = small.k;
    const mw = small.img.w,
      mh = small.img.h;
    const sm = new Uint8Array(mw * mh);
    for (let y = 0; y < mh; y++)
      for (let x = 0; x < mw; x++) sm[y * mw + x] = m.data[Math.min(src.h - 1, Math.floor(y / k)) * src.w + Math.min(src.w - 1, Math.floor(x / k))]!;
    return { src, m, small: small.img, smallMask: { w: mw, h: mh, data: sm }, k };
  }, [s, maskLayer]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      const scaled = { ...o, radius: o.radius * base.k, smooth: o.smooth * base.k, feather: o.feather * base.k };
      const m = refineEdge(base.small, base.smallMask, scaled);
      const im = base.small;
      const out: Img = { w: im.w, h: im.h, c: 4, data: new Float32Array(im.w * im.h * 4) };
      for (let i = 0; i < im.w * im.h; i++) {
        const a = m.data[i]! / 255;
        const r = im.data[i * 4]!,
          g = im.data[i * 4 + 1]!,
          b = im.data[i * 4 + 2]!;
        let c: [number, number, number];
        if (view === 'bw') c = [a, a, a];
        else if (view === 'black') c = [r * a, g * a, b * a];
        else if (view === 'white') c = [r * a + 1 - a, g * a + 1 - a, b * a + 1 - a];
        else if (view === 'overlay')
          c = [r * a + (r * 0.5 + 0.5) * (1 - a) * (1 - opacity) + opacity * (1 - a), g * a + g * (1 - a) * (1 - opacity), b * a + b * (1 - a) * (1 - opacity)];
        else
          c = [
            r * a + (r * (1 - opacity) + 0.8 * opacity) * (1 - a),
            g * a + (g * (1 - opacity) + 0.8 * opacity) * (1 - a),
            b * a + (b * (1 - opacity) + 0.8 * opacity) * (1 - a),
          ];
        out.data.set([c[0], c[1], c[2], 1], i * 4);
      }
      drawImg(canvas.current, out);
    }, 60);
    return () => clearTimeout(t);
  }, [o, view, opacity, base]);
  const ok = async () => {
    onClose();
    const m = await busy('Refining the edge…', async () => refineEdge(base.src, base.m, o));
    if (output === 'selection') {
      change('Select and Mask', 'select', (d) => withSelection(d, m));
      return;
    }
    const l = s.activeLayer();
    if (!l) return;
    const mask = { raster: maskToRaster(m), background: 0, enabled: true, linked: true, density: 1, feather: 0 };
    if (output === 'mask' || output === 'layerMask')
      change('Select and Mask', 'mask', (d) => withSelection({ ...d, layers: updateLayer(d.layers, l.id, (x) => ({ ...x, mask })) }, null));
    bump();
  };
  const set = (k: keyof typeof o, v: number) => setO({ ...o, [k]: v });
  return (
    <Frame
      title="Select and Mask"
      onOk={() => void ok()}
      onCancel={onClose}
      side={
        <>
          <div className="lp-section-title" style={{ marginTop: 0 }}>
            View
          </div>
          <div className="lp-panel-row">
            <Select
              value={view}
              title="View mode"
              options={[
                ['onion', 'Onion Skin'],
                ['overlay', 'Overlay'],
                ['black', 'On Black'],
                ['white', 'On White'],
                ['bw', 'Black & White'],
              ]}
              onChange={setView}
            />
          </div>
          {(view === 'onion' || view === 'overlay') && (
            <Slider label="Opacity" value={opacity} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={setOpacity} />
          )}
          <div className="lp-section-title">Edge Detection</div>
          <Slider label="Radius" value={o.radius} min={0} max={250} suffix="px" onChange={(v) => set('radius', v)} />
          <div className="lp-note">A radius lets soft edges like hair follow the picture.</div>
          <div className="lp-section-title">Global Refinements</div>
          <Slider label="Smooth" value={o.smooth} min={0} max={100} onChange={(v) => set('smooth', v)} />
          <Slider label="Feather" value={o.feather} min={0} max={250} step={0.1} digits={1} suffix="px" onChange={(v) => set('feather', v)} />
          <Slider label="Contrast" value={o.contrast} min={0} max={1} step={0.01} scale={100} suffix="%" onChange={(v) => set('contrast', v)} />
          <Slider label="Shift Edge" value={o.shiftEdge} min={-1} max={1} step={0.01} scale={100} suffix="%" onChange={(v) => set('shiftEdge', v)} />
          <div className="lp-section-title">Output</div>
          <Select
            label="Output To"
            value={output}
            options={[
              ['selection', 'Selection'],
              ['mask', 'Layer Mask'],
            ]}
            onChange={setOutput}
          />
        </>
      }
    >
      <canvas ref={canvas} />
    </Frame>
  );
}

// ---- Liquify ----

type LTool = 'forward' | 'reconstruct' | 'twirl' | 'pucker' | 'bloat' | 'smooth';

function Liquify({ onClose }: { onClose: () => void }) {
  const s = current()!;
  const l = s.activeLayer();
  const [tool, setTool] = useState<LTool>('forward');
  const [size, setSize] = useState(100);
  const [pressure, setPressure] = useState(0.5);
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = useMemo(() => {
    const r = canvasRect(s.doc);
    const data = l && 'raster' in l ? l.raster.read(r) : new Float32Array(r.w * r.h * 4);
    const red = reduce({ w: r.w, h: r.h, c: 4, data }, 1200);
    return { full: { w: r.w, h: r.h, c: 4 as const, data }, ...red };
  }, [s, l]);
  const field = useRef({ dx: new Float32Array(base.img.w * base.img.h), dy: new Float32Array(base.img.w * base.img.h) });
  const [, setTick] = useState(0);
  const redraw = () => drawImg(canvas.current, displace(base.img, field.current.dx, field.current.dy));
  useEffect(() => redraw(), [base]);
  const last = useRef<[number, number] | null>(null);
  const stroke = (x: number, y: number, mx: number, my: number) => {
    const { w, h } = base.img;
    const { dx, dy } = field.current;
    const r = (size * base.k) / 2;
    const x0 = Math.max(0, Math.floor(x - r)),
      x1 = Math.min(w - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)),
      y1 = Math.min(h - 1, Math.ceil(y + r));
    const ndx = dx.slice(),
      ndy = dy.slice();
    for (let py = y0; py <= y1; py++)
      for (let px = x0; px <= x1; px++) {
        const ox = px - x,
          oy = py - y;
        const d = Math.sqrt(ox * ox + oy * oy) / r;
        if (d >= 1) continue;
        const f = (1 - d * d) * (1 - d * d) * pressure;
        const i = py * w + px;
        if (tool === 'forward') {
          ndx[i] = dx[i]! - mx * f;
          ndy[i] = dy[i]! - my * f;
        } else if (tool === 'reconstruct') {
          ndx[i] = dx[i]! * (1 - f * 0.3);
          ndy[i] = dy[i]! * (1 - f * 0.3);
        } else if (tool === 'twirl') {
          ndx[i] = dx[i]! + oy * f * 0.08;
          ndy[i] = dy[i]! - ox * f * 0.08;
        } else if (tool === 'pucker') {
          ndx[i] = dx[i]! + ox * f * 0.06;
          ndy[i] = dy[i]! + oy * f * 0.06;
        } else if (tool === 'bloat') {
          ndx[i] = dx[i]! - ox * f * 0.06;
          ndy[i] = dy[i]! - oy * f * 0.06;
        } else {
          // Smooth: toward the neighbors' average.
          const n = (a: Float32Array) => (a[i]! + (a[i - 1] ?? a[i]!) + (a[i + 1] ?? a[i]!) + (a[i - w] ?? a[i]!) + (a[i + w] ?? a[i]!)) / 5;
          ndx[i] = dx[i]! + (n(dx) - dx[i]!) * f;
          ndy[i] = dy[i]! + (n(dy) - dy[i]!) * f;
        }
      }
    field.current = { dx: ndx, dy: ndy };
    redraw();
  };
  const at = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * base.img.w, ((e.clientY - r.top) / r.height) * base.img.h];
  };
  const ok = async () => {
    onClose();
    if (!l || !('raster' in l) || l.kind !== 'pixel') {
      toast('Liquify works on a pixel layer.');
      return;
    }
    await busy('Liquify…', async () => {
      const { full, img, k } = base;
      // Scale the field up to full size (and its lengths by 1/k).
      const fx = { w: img.w, h: img.h, c: 1 as const, data: field.current.dx };
      const fy = { w: img.w, h: img.h, c: 1 as const, data: field.current.dy };
      const bx = k < 1 ? resize(fx, full.w, full.h, 'bilinear').data : fx.data;
      const by = k < 1 ? resize(fy, full.w, full.h, 'bilinear').data : fy.data;
      if (k < 1)
        for (let i = 0; i < bx.length; i++) {
          bx[i] = bx[i]! / k;
          by[i] = by[i]! / k;
        }
      const out = displace(full, bx, by);
      const e = new TileEdit(l.raster as Raster);
      (l.raster as Raster).write(canvasRect(s.doc), out.data, e);
      change('Liquify', 'filter', (d) => ({ ...d, layers: updateLayer(d.layers, l.id, (x) => ({ ...x })) }), [e.commit()]);
    });
  };
  const TOOLS: [LTool, string][] = [
    ['forward', 'Forward Warp'],
    ['reconstruct', 'Reconstruct'],
    ['smooth', 'Smooth'],
    ['twirl', 'Twirl Clockwise'],
    ['pucker', 'Pucker'],
    ['bloat', 'Bloat'],
  ];
  return (
    <Frame
      title="Liquify"
      onOk={() => void ok()}
      onCancel={onClose}
      side={
        <>
          <div className="lp-section-title" style={{ marginTop: 0 }}>
            Tool
          </div>
          <div className="lp-list-pick">
            {TOOLS.map(([id, n]) => (
              <button key={id} aria-pressed={tool === id} onClick={() => setTool(id)}>
                {n}
              </button>
            ))}
          </div>
          <div className="lp-section-title">Brush</div>
          <Slider label="Size" value={size} min={5} max={1500} suffix="px" onChange={setSize} />
          <Slider label="Pressure" value={pressure} min={0.01} max={1} step={0.01} scale={100} suffix="%" onChange={setPressure} />
          <div className="lp-panel-row" style={{ marginTop: 10 }}>
            <button
              className="lp-btn"
              onClick={() => {
                field.current = { dx: new Float32Array(base.img.w * base.img.h), dy: new Float32Array(base.img.w * base.img.h) };
                redraw();
                setTick((t) => t + 1);
              }}
            >
              Restore All
            </button>
          </div>
        </>
      }
    >
      <canvas
        ref={canvas}
        style={{ cursor: 'crosshair' }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          last.current = at(e);
          if (tool !== 'forward') stroke(...last.current, 0, 0);
        }}
        onPointerMove={(e) => {
          if (!last.current) return;
          const [x, y] = at(e);
          stroke(x, y, x - last.current[0], y - last.current[1]);
          last.current = [x, y];
        }}
        onPointerUp={() => {
          last.current = null;
        }}
      />
    </Frame>
  );
}

export { pixelLayer, insertLayers, nextName };
