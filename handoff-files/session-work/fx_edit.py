import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

edit('titler/src/core/types.ts', [
("""  | { id: string; type: 'fill'; on: boolean; color: ColorRef };""", """  | { id: string; type: 'fill'; on: boolean; color: ColorRef }
  /** An outline around the layer's shape (text, logos, pictures with see-through parts). */
  | { id: string; type: 'stroke'; on: boolean; color: ColorRef; width: Prop; opacity: Prop }
  /** A gradient over the layer's own pixels (across its box, at an angle). */
  | { id: string; type: 'gradient'; on: boolean; angle: number; stops: GradientStop[]; opacity: Prop }
  /** Film grain over the layer (moving, or still). */
  | { id: string; type: 'noise'; on: boolean; amount: Prop; still?: boolean }
  /** Color correction: brightness, contrast and saturation (−100…100), hue turn (degrees). */
  | { id: string; type: 'color'; on: boolean; brightness: Prop; contrast: Prop; saturation: Prop; hue: Prop };"""),
])

edit('titler/src/designer/props.ts', [
("""    } else if (e.type === 'blur') out.push({ path: `effects.${i}.amount`, label: `${name}: amount`, dims: 1, fallback: 4, unit: 'px' });""", """    } else if (e.type === 'blur') out.push({ path: `effects.${i}.amount`, label: `${name}: amount`, dims: 1, fallback: 4, unit: 'px' });
    else if (e.type === 'stroke') {
      out.push({ path: `effects.${i}.width`, label: `${name}: width`, dims: 1, fallback: 3, unit: 'px' });
      out.push({ path: `effects.${i}.opacity`, label: `${name}: opacity`, dims: 1, fallback: 100, unit: '%' });
    } else if (e.type === 'gradient') out.push({ path: `effects.${i}.opacity`, label: `${name}: opacity`, dims: 1, fallback: 100, unit: '%' });
    else if (e.type === 'noise') out.push({ path: `effects.${i}.amount`, label: `${name}: amount`, dims: 1, fallback: 10, unit: '%' });
    else if (e.type === 'color')
      for (const k of ['brightness', 'contrast', 'saturation'] as const) out.push({ path: `effects.${i}.${k}`, label: `${name}: ${k}`, dims: 1, fallback: 0 });"""),
("""export const EFFECT_NAMES: Record<string, string> = { dropShadow: 'Drop shadow', glow: 'Glow', blur: 'Blur', fill: 'Color fill' };""", """export const EFFECT_NAMES: Record<string, string> = {
  dropShadow: 'Drop shadow',
  glow: 'Glow',
  blur: 'Blur',
  fill: 'Color fill',
  stroke: 'Outline',
  gradient: 'Gradient overlay',
  noise: 'Grain',
  color: 'Color correction',
};"""),
])

edit('titler/src/core/render.ts', [
("""  const fx = effectsOn(l);
  for (const e of fx) if (e.type === 'blur') blurCanvas(own, num(e.amount, t, 0) * s.f.px, s);
  for (const e of fx) if (e.type === 'fill') tintCanvas(own, resolveColor(e.color, s.f.tokens, s.f.values));""", """  const fx = effectsOn(l);
  for (const e of fx) if (e.type === 'blur') blurCanvas(own, num(e.amount, t, 0) * s.f.px, s);
  for (const e of fx) if (e.type === 'fill') tintCanvas(own, resolveColor(e.color, s.f.tokens, s.f.values));
  const area = () => canvasBox(own, l, world, s);
  for (const e of fx) if (e.type === 'gradient') gradientCanvas(own, e, area(), s);
  for (const e of fx) if (e.type === 'color') colorCanvas(own, e, s);
  for (const e of fx) if (e.type === 'noise') noiseCanvas(own, e, area(), l.id, s);
  for (const e of fx) if (e.type === 'stroke') strokeCanvas(own, e, s);"""),
("""function blurCanvas(c: Ctx, amount: number, s: Scene) {""", """/** The part of the canvas a layer covers (its box through its transform), px. */
function canvasBox(c: Ctx, l: Layer, world: Mat, s: Scene): { x: number; y: number; w: number; h: number } {
  const [w, h] = l.type === 'group' ? [0, 0] : contentSize(l, s.t, s.f.project);
  if (!w || !h) return { x: 0, y: 0, w: c.canvas.width, h: c.canvas.height };
  const pts = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ].map(([x, y]) => [world[0] * x! + world[2] * y! + world[4], world[1] * x! + world[3] * y! + world[5]] as const);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(c.canvas.width, Math.ceil(Math.max(...xs)));
  const y1 = Math.min(c.canvas.height, Math.ceil(Math.max(...ys)));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** A gradient over the layer's own pixels only. */
function gradientCanvas(c: Ctx, e: Extract<Effect, { type: 'gradient' }>, b: { x: number; y: number; w: number; h: number }, s: Scene) {
  if (!e.stops.length || !b.w || !b.h) return;
  const a = (e.angle * Math.PI) / 180;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const r = (Math.abs(Math.cos(a)) * b.w + Math.abs(Math.sin(a)) * b.h) / 2;
  const g = c.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  for (const st of e.stops) g.addColorStop(Math.min(1, Math.max(0, st.at)), resolveColor(st.color, s.f.tokens, s.f.values));
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-atop';
  c.globalAlpha = Math.max(0, Math.min(1, num(e.opacity, s.t, 100) / 100));
  c.fillStyle = g;
  c.fillRect(b.x, b.y, b.w, b.h);
  c.restore();
}

/** Brightness, contrast, saturation and hue, through the canvas's filter. */
function colorCanvas(c: Ctx, e: Extract<Effect, { type: 'color' }>, s: Scene) {
  const t = s.t;
  const br = 1 + num(e.brightness, t, 0) / 100;
  const co = 1 + num(e.contrast, t, 0) / 100;
  const sa = 1 + num(e.saturation, t, 0) / 100;
  const hu = num(e.hue, t, 0);
  if (br === 1 && co === 1 && sa === 1 && !hu) return;
  const copy = s.f.env.createCanvas(c.canvas.width, c.canvas.height);
  const cc = copy?.getContext('2d') as Ctx | null;
  if (!copy || !cc) return;
  cc.drawImage(c.canvas as CanvasImageSource, 0, 0);
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  c.filter = `brightness(${round(Math.max(0, br))}) contrast(${round(Math.max(0, co))}) saturate(${round(Math.max(0, sa))}) hue-rotate(${round(hu)}deg)`;
  c.drawImage(copy as CanvasImageSource, 0, 0);
  c.restore();
}

/** Grain: the same at the same time (seeded by the layer and the frame), so renders are repeatable. */
function noiseCanvas(c: Ctx, e: Extract<Effect, { type: 'noise' }>, b: { x: number; y: number; w: number; h: number }, id: string, s: Scene) {
  const amount = Math.max(0, Math.min(100, num(e.amount, s.t, 10))) / 100;
  if (amount <= 0 || !b.w || !b.h) return;
  const img = c.getImageData(b.x, b.y, b.w, b.h);
  const d = img.data;
  let seed = 2166136261;
  for (const ch of id) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  if (!e.still) seed ^= Math.round(s.t * 60) * 2654435761;
  const k = amount * 128;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const n = ((seed >>> 0) / 4294967296 - 0.5) * 2 * k;
    d[i] = d[i]! + n;
    d[i + 1] = d[i + 1]! + n;
    d[i + 2] = d[i + 2]! + n;
  }
  c.putImageData(img, b.x, b.y);
}

/** An outline around the layer's shape: its tinted copy drawn round it, under it. */
function strokeCanvas(c: Ctx, e: Extract<Effect, { type: 'stroke' }>, s: Scene) {
  const w = num(e.width, s.t, 3) * s.f.px;
  if (w <= 0.05) return;
  const W = c.canvas.width;
  const H = c.canvas.height;
  const tint = s.f.env.createCanvas(W, H);
  const ring = s.f.env.createCanvas(W, H);
  const tc = tint?.getContext('2d') as Ctx | null;
  const rc = ring?.getContext('2d') as Ctx | null;
  if (!tint || !ring || !tc || !rc) return;
  tc.drawImage(c.canvas as CanvasImageSource, 0, 0);
  tintCanvas(tc, resolveColor(e.color, s.f.tokens, s.f.values, '#000000'));
  // The shape moved round a circle of the outline's width, in steps fine enough for a smooth edge.
  const steps = Math.min(48, Math.max(12, Math.ceil(w * 3)));
  for (let r = w; r > 0; r -= Math.max(1, w / 2)) for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    rc.drawImage(tint as CanvasImageSource, Math.cos(a) * r, Math.sin(a) * r);
  }
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'destination-over';
  c.globalAlpha = Math.max(0, Math.min(1, num(e.opacity, s.t, 100) / 100));
  c.drawImage(ring as CanvasImageSource, 0, 0);
  c.restore();
}

function blurCanvas(c: Ctx, amount: number, s: Scene) {"""),
])

edit('titler/src/designer/Inspector.tsx', [
("""          : type === 'blur'
            ? { id, type, on: true, amount: { v: 4 } }
            : { id, type, on: true, color: '$accent' };""", """          : type === 'blur'
            ? { id, type, on: true, amount: { v: 4 } }
            : type === 'stroke'
              ? { id, type, on: true, color: '$box', width: { v: 3 }, opacity: { v: 100 } }
              : type === 'gradient'
                ? {
                    id,
                    type,
                    on: true,
                    angle: 90,
                    stops: [
                      { at: 0, color: '#ffffff' },
                      { at: 1, color: '#000000' },
                    ],
                    opacity: { v: 25 },
                  }
                : type === 'noise'
                  ? { id, type, on: true, amount: { v: 8 } }
                  : type === 'color'
                    ? { id, type, on: true, brightness: { v: 0 }, contrast: { v: 0 }, saturation: { v: 0 }, hue: { v: 0 } }
                    : { id, type, on: true, color: '$accent' };"""),
("""          {e.type === 'blur' && (
            <Row label="Amount">""", """          {e.type === 'stroke' && (
            <Row label="Outline">
              <NumberField
                value={valueAt(e.width as never, 0, 0 as never) as number}
                min={0}
                label="Outline width"
                unit="px"
                onChange={(v) => set(i, { width: { v } } as Partial<Effect>)}
              />
              <NumberField
                value={valueAt(e.opacity as never, 0, 0 as never) as number}
                min={0}
                max={100}
                label="Outline opacity"
                unit="%"
                onChange={(v) => set(i, { opacity: { v } } as Partial<Effect>)}
              />
            </Row>
          )}
          {e.type === 'gradient' && (
            <>
              <Row label="Gradient">
                <NumberField value={e.angle} label="Gradient angle" unit="°" onChange={(angle) => set(i, { angle } as Partial<Effect>)} />
                <NumberField
                  value={valueAt(e.opacity as never, 0, 0 as never) as number}
                  min={0}
                  max={100}
                  label="Gradient opacity"
                  unit="%"
                  onChange={(v) => set(i, { opacity: { v } } as Partial<Effect>)}
                />
              </Row>
              {e.stops.map((st, k) => (
                <Row key={k} label={k === 0 ? 'From' : 'To'}>
                  <ColorField
                    value={st.color}
                    onChange={(color) => set(i, { stops: e.stops.map((x, j) => (j === k ? { ...x, color } : x)) } as Partial<Effect>)}
                    tokens={tokens}
                    values={vals}
                    label={k === 0 ? 'Gradient from' : 'Gradient to'}
                    fields={fieldKeys}
                  />
                </Row>
              ))}
            </>
          )}
          {e.type === 'noise' && (
            <Row label="Grain">
              <NumberField
                value={valueAt(e.amount as never, 0, 0 as never) as number}
                min={0}
                max={100}
                label="Grain amount"
                unit="%"
                onChange={(v) => set(i, { amount: { v } } as Partial<Effect>)}
              />
              <Toggle value={!!e.still} onChange={(still) => set(i, { still } as Partial<Effect>)} label="Still" />
            </Row>
          )}
          {e.type === 'color' && (
            <>
              <Row label="Light">
                <NumberField
                  value={valueAt(e.brightness as never, 0, 0 as never) as number}
                  min={-100}
                  max={100}
                  label="Brightness"
                  onChange={(v) => set(i, { brightness: { v } } as Partial<Effect>)}
                />
                <NumberField
                  value={valueAt(e.contrast as never, 0, 0 as never) as number}
                  min={-100}
                  max={100}
                  label="Contrast"
                  onChange={(v) => set(i, { contrast: { v } } as Partial<Effect>)}
                />
              </Row>
              <Row label="Color">
                <NumberField
                  value={valueAt(e.saturation as never, 0, 0 as never) as number}
                  min={-100}
                  max={100}
                  label="Saturation"
                  onChange={(v) => set(i, { saturation: { v } } as Partial<Effect>)}
                />
                <NumberField
                  value={valueAt(e.hue as never, 0, 0 as never) as number}
                  label="Hue"
                  unit="°"
                  onChange={(v) => set(i, { hue: { v } } as Partial<Effect>)}
                />
              </Row>
            </>
          )}
          {e.type === 'blur' && (
            <Row label="Amount">"""),
("""        {(['dropShadow', 'glow', 'blur', 'fill'] as const).map((t) => (""", """        {(['dropShadow', 'glow', 'stroke', 'blur', 'fill', 'gradient', 'color', 'noise'] as const).map((t) => ("""),
])
print('ok')
