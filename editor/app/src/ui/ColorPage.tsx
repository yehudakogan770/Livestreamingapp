import { useEffect, useRef, useState } from 'react';
import { valueAt, setValue } from '../model/anim';
import { newEffect } from '../model/effects';
import { current, end } from '../model/seq';
import type { Clip, Effect, Param } from '../model/types';
import { selectedIds, useDoc, type Doc } from '../doc';
import type { Engine } from '../player/engine';
import { curveTable, type CurvePoints, type CurveSet } from '../render/color';
import type { Actions } from './actions';
import { Choice, ParamRow, Section } from './controls';
import { drag, usePlayhead } from './hooks';
import { useUi, type Ui } from './state';

/** The clip being graded: the selected picture clip, or the top one at the playhead. */
export function gradedClip(doc: Doc, frame: number): Clip | undefined {
  const s = current(doc.project);
  const ids = selectedIds(doc.state.selection);
  const isVideo = (c: Clip) => s.tracks.find((t) => t.id === c.track)?.kind === 'video';
  const sel = s.clips.find((c) => ids.includes(c.id) && isVideo(c));
  if (sel) return sel;
  return s.tracks
    .filter((t) => t.kind === 'video' && !t.off)
    .reverse()
    .map((t) => s.clips.find((c) => c.track === t.id && frame >= c.start && frame < end(c) && c.source.kind !== 'text'))
    .find(Boolean);
}

export function ColorPanel({ doc, engine, actions }: { doc: Doc; engine: Engine; actions: Actions }) {
  useDoc(doc);
  const t = usePlayhead(engine);
  const clip = gradedClip(doc, t);
  if (!clip) return <div className="colorp colorp--empty">Put the playhead over a clip (or select one) to change its color.</div>;
  const local = Math.max(0, Math.min(clip.length - 1, t - clip.start));
  const find = (type: string) => clip.effects.find((e) => e.type === type);
  /** Change an effect, adding it first if the clip doesn't have it yet. */
  const change = (type: string, f: (e: Effect) => Effect, final: boolean) => {
    actions.update(
      [clip.id],
      'Color',
      (c) => {
        const have = c.effects.find((e) => e.type === type);
        const e = have ?? newEffect(type);
        const next = f(e);
        return { ...c, effects: have ? c.effects.map((x) => (x.id === e.id ? next : x)) : [...c.effects, next] };
      },
      final ? undefined : `color-${clip.id}-${type}`,
    );
  };
  const setParam = (type: string, key: string, p: Param, final: boolean) => change(type, (e) => ({ ...e, p: { ...e.p, [key]: p } }), final);
  const seek = (f: number) => {
    engine.pause();
    engine.seek(f);
  };
  const basic = find('basic');
  const wheels = find('wheels');
  const curves = find('curves');
  const hsl = find('hsl');
  const row = (type: string, e: Effect | undefined, key: string, label: string, def: number, min: number, max: number, step: number, unit?: string) => (
    <ParamRow
      key={key}
      label={label}
      param={e?.p[key]}
      local={local}
      def={def}
      min={min}
      max={max}
      step={step}
      unit={unit}
      clipStart={clip.start}
      onSeek={seek}
      onChange={(p, final) => setParam(type, key, p, final)}
    />
  );
  return (
    <div className="colorp">
      <div className="colorp__col colorp__col--wheels">
        <h3>
          Color wheels <small>for {clip.name}</small>
          {wheels && (
            <button
              type="button"
              className="sect__btn"
              title="Reset the wheels"
              onClick={() => change('wheels', (e) => ({ ...newEffect('wheels'), id: e.id }), true)}
            >
              ↺
            </button>
          )}
        </h3>
        <div className="wheels">
          {(
            [
              ['lift', 'Shadows'],
              ['gamma', 'Midtones'],
              ['gain', 'Highlights'],
            ] as const
          ).map(([k, name]) => (
            <Wheel
              key={k}
              name={name}
              x={valueAt(wheels?.p[`${k}X`], local)}
              y={valueAt(wheels?.p[`${k}Y`], local)}
              level={valueAt(wheels?.p[k], local)}
              onPuck={(x, y, final) =>
                change(
                  'wheels',
                  (e) => ({ ...e, p: { ...e.p, [`${k}X`]: setValue(e.p[`${k}X`], local, x), [`${k}Y`]: setValue(e.p[`${k}Y`], local, y) } }),
                  final,
                )
              }
              onLevel={(v, final) => change('wheels', (e) => ({ ...e, p: { ...e.p, [k]: setValue(e.p[k], local, v) } }), final)}
            />
          ))}
        </div>
      </div>
      <div className="colorp__col">
        <Section
          title="Basic"
          actions={
            basic && (
              <button type="button" className="sect__btn" title="Reset" onClick={() => change('basic', (e) => ({ ...newEffect('basic'), id: e.id }), true)}>
                ↺
              </button>
            )
          }
        >
          {row('basic', basic, 'exposure', 'Exposure', 0, -4, 4, 0.05)}
          {row('basic', basic, 'contrast', 'Contrast', 0, -100, 100, 1)}
          {row('basic', basic, 'highlights', 'Highlights', 0, -100, 100, 1)}
          {row('basic', basic, 'shadows', 'Shadows', 0, -100, 100, 1)}
          {row('basic', basic, 'whites', 'Whites', 0, -100, 100, 1)}
          {row('basic', basic, 'blacks', 'Blacks', 0, -100, 100, 1)}
          {row('basic', basic, 'temperature', 'Temperature', 0, -100, 100, 1)}
          {row('basic', basic, 'tint', 'Tint', 0, -100, 100, 1)}
          {row('basic', basic, 'saturation', 'Saturation', 100, 0, 200, 1, '%')}
          {row('basic', basic, 'vibrance', 'Vibrance', 0, -100, 100, 1)}
        </Section>
      </div>
      <div className="colorp__col">
        <CurvesEditor
          set={(curves?.d as unknown as CurveSet | undefined) ?? (newEffect('curves').d as unknown as CurveSet)}
          onChange={(set, final) => change('curves', (e) => ({ ...e, d: set as unknown as Record<string, unknown> }), final)}
        />
        <Section title="Change one color" open={!!hsl}>
          {row('hsl', hsl, 'hue', 'Which color', 30, 0, 360, 1, '°')}
          {row('hsl', hsl, 'range', 'How wide', 30, 5, 180, 1, '°')}
          {row('hsl', hsl, 'shift', 'Hue shift', 0, -180, 180, 1, '°')}
          {row('hsl', hsl, 'sat', 'Saturation', 0, -100, 100, 1)}
          {row('hsl', hsl, 'light', 'Lightness', 0, -100, 100, 1)}
        </Section>
        <div className="insp__row">
          <button type="button" className="btn btn--sm" onClick={() => actions.addEffect([clip.id], 'lut')}>
            + LUT
          </button>
          <button type="button" className="btn btn--sm" onClick={() => actions.addEffect([clip.id], 'vignette')}>
            + Vignette
          </button>
          <button
            type="button"
            className="btn btn--sm"
            title="Copy this clip's color to every clip from the same camera"
            onClick={() => {
              const s = current(doc.project);
              const src = clip.source;
              const same = s.clips.filter(
                (c) =>
                  c.id !== clip.id &&
                  ((src.kind === 'multicam' && c.source.kind === 'multicam' && c.source.angle === src.angle) ||
                    (src.kind === 'media' && c.source.kind === 'media' && c.source.media === src.media)),
              );
              const color = clip.effects.filter((e) => ['basic', 'wheels', 'curves', 'hsl', 'lut', 'vignette'].includes(e.type));
              actions.update(
                same.map((c) => c.id),
                'Match color',
                (c) => ({
                  ...c,
                  effects: [
                    ...c.effects.filter((e) => !['basic', 'wheels', 'curves', 'hsl', 'lut', 'vignette'].includes(e.type)),
                    ...color.map((e) => ({ ...structuredClone(e), id: `${e.id}-${c.id}` })),
                  ],
                }),
              );
            }}
          >
            Same for this camera
          </button>
        </div>
      </div>
    </div>
  );
}

/** A color wheel: drag the dot toward a color; the slider under it is brighter or darker. */
function Wheel({
  name,
  x,
  y,
  level,
  onPuck,
  onLevel,
}: {
  name: string;
  x: number;
  y: number;
  level: number;
  onPuck: (x: number, y: number, final: boolean) => void;
  onLevel: (v: number, final: boolean) => void;
}) {
  const size = 120;
  const r = size / 2 - 6;
  const ref = useRef<HTMLDivElement>(null);
  const at = (cx: number, cy: number): [number, number] => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return [0, 0];
    let dx = (cx - box.left - size / 2) / r;
    let dy = -(cy - box.top - size / 2) / r;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      dx /= d;
      dy /= d;
    }
    return [Math.round(dx * 100) / 100, Math.round(dy * 100) / 100];
  };
  return (
    <div className="wheel">
      <div
        ref={ref}
        className="wheel__disc"
        style={{ width: size, height: size }}
        onPointerDown={(e) => {
          const [nx, ny] = at(e.clientX, e.clientY);
          onPuck(nx, ny, false);
          drag(
            e,
            (_dx, _dy, ev) => {
              const [px, py] = at(ev.clientX, ev.clientY);
              onPuck(ev.shiftKey ? px * 0.25 : px, ev.shiftKey ? py * 0.25 : py, false);
            },
            (ev) => {
              const [px, py] = at(ev.clientX, ev.clientY);
              onPuck(px, py, true);
            },
          );
        }}
        onDoubleClick={() => onPuck(0, 0, true)}
        title="Drag toward a color (double-click to reset)"
      >
        <i className="wheel__puck" style={{ left: size / 2 + x * r, top: size / 2 - y * r }} />
      </div>
      <span className="wheel__name">{name}</span>
      <input
        type="range"
        min={-100}
        max={100}
        value={level}
        aria-label={`${name} level`}
        onChange={(e) => onLevel(Number(e.target.value), false)}
        onPointerUp={() => onLevel(level, true)}
        onDoubleClick={() => onLevel(0, true)}
      />
    </div>
  );
}

const CHANNELS: [keyof CurveSet, string, string][] = [
  ['master', 'All', '#e6e6e6'],
  ['r', 'Red', '#ff5a52'],
  ['g', 'Green', '#5bd46a'],
  ['b', 'Blue', '#5a8cff'],
];

function CurvesEditor({ set, onChange }: { set: CurveSet; onChange: (s: CurveSet, final: boolean) => void }) {
  const [ch, setCh] = useState<keyof CurveSet>('master');
  const ref = useRef<HTMLCanvasElement>(null);
  const W = 240;
  const H = 180;
  const pts = set[ch];
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#2a2f37';
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo((W * i) / 4, 0);
      ctx.lineTo((W * i) / 4, H);
      ctx.moveTo(0, (H * i) / 4);
      ctx.lineTo(W, (H * i) / 4);
      ctx.stroke();
    }
    ctx.strokeStyle = '#3a404a';
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(W, 0);
    ctx.stroke();
    for (const [key, , color] of CHANNELS) {
      if (key !== ch) continue;
      const table = curveTable(set[key]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * W;
        const y = H - (table[i] ?? 0) * H;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = color;
      for (const [px, py] of set[key]) {
        ctx.beginPath();
        ctx.arc(px * W, H - py * H, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [set, ch]);
  const toPt = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return [0, 0];
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))];
  };
  const write = (list: CurvePoints, final: boolean) => onChange({ ...set, [ch]: [...list].sort((a, b) => a[0] - b[0]) }, final);
  return (
    <Section
      title="Curves"
      actions={
        <button
          type="button"
          className="sect__btn"
          title="Straighten this curve"
          onClick={() =>
            write(
              [
                [0, 0],
                [1, 1],
              ],
              true,
            )
          }
        >
          ↺
        </button>
      }
    >
      <Choice value={ch} options={CHANNELS.map(([k, n]) => [k, n] as [keyof CurveSet, string])} onChange={setCh} label="Channel" />
      <canvas
        ref={ref}
        className="curves"
        width={W}
        height={H}
        title="Click to add a point, drag to move it, double-click a point to remove it"
        onPointerDown={(e) => {
          const p = toPt(e);
          let list: CurvePoints = pts.map((x) => [...x] as [number, number]);
          let i = list.findIndex(([x, y]) => Math.hypot((x - p[0]) * W, (y - p[1]) * H) < 9);
          if (i < 0) {
            list.push(p);
            list.sort((a, b) => a[0] - b[0]);
            i = list.findIndex((x) => x === p || (x[0] === p[0] && x[1] === p[1]));
          }
          const idx = i;
          const ends = idx === 0 || idx === list.length - 1;
          write(list, false);
          drag(
            e,
            (_dx, _dy, ev) => {
              const q = toPt(ev);
              list = list.map((x, k) => (k === idx ? [ends ? x[0] : q[0], q[1]] : x)) as CurvePoints;
              write(list, false);
            },
            () => write(list, true),
          );
        }}
        onDoubleClick={(e) => {
          const p = toPt(e);
          const i = pts.findIndex(([x, y]) => Math.hypot((x - p[0]) * W, (y - p[1]) * H) < 9);
          if (i > 0 && i < pts.length - 1)
            write(
              pts.filter((_, k) => k !== i),
              true,
            );
        }}
      />
    </Section>
  );
}

/** Scopes: how bright and how colorful the picture is, measured. */
export function Scopes({ engine, ui }: { engine: Engine; ui: Ui }) {
  const u = useUi(ui);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let last = 0;
    let pending = false;
    const draw = () => {
      const cv = ref.current;
      const gl = engine.gl;
      if (!cv || !gl) return;
      const now = performance.now();
      if (now - last < 120) {
        if (!pending) {
          pending = true;
          setTimeout(() => {
            pending = false;
            draw();
          }, 130);
        }
        return;
      }
      last = now;
      const w = 192;
      const h = 108;
      let px: Uint8Array;
      try {
        px = gl.readSmall(w, h);
      } catch {
        return;
      }
      drawScope(cv, px, w, h, ui.state.scope);
    };
    engine.onFrame = draw;
    engine.redraw();
    return () => {
      if (engine.onFrame === draw) engine.onFrame = null;
    };
  }, [engine, ui, u.scope]);
  return (
    <div className="scopes">
      <div className="scopes__head">
        <Choice
          value={u.scope}
          options={[
            ['waveform', 'Waveform'],
            ['parade', 'RGB parade'],
            ['vectorscope', 'Vectorscope'],
            ['histogram', 'Histogram'],
          ]}
          onChange={(v) => ui.set({ scope: v })}
          label="Scope"
        />
      </div>
      <canvas ref={ref} className="scopes__canvas" width={384} height={220} />
    </div>
  );
}

function drawScope(cv: HTMLCanvasElement, px: Uint8Array, w: number, h: number, kind: string) {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const W = cv.width;
  const H = cv.height;
  ctx.fillStyle = '#0b0c0e';
  ctx.fillRect(0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const add = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (Math.floor(y) * W + Math.floor(x)) * 4;
    d[i] = Math.min(255, (d[i] ?? 0) + r);
    d[i + 1] = Math.min(255, (d[i + 1] ?? 0) + g);
    d[i + 2] = Math.min(255, (d[i + 2] ?? 0) + b);
  };
  if (kind === 'waveform' || kind === 'parade') {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = px[i] ?? 0;
        const g = px[i + 1] ?? 0;
        const b = px[i + 2] ?? 0;
        if (kind === 'waveform') {
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          add((x / w) * W, H - 4 - (l / 255) * (H - 8), 40, 60, 40);
        } else {
          const third = W / 3;
          add((x / w) * third, H - 4 - (r / 255) * (H - 8), 70, 18, 18);
          add(third + (x / w) * third, H - 4 - (g / 255) * (H - 8), 18, 70, 18);
          add(2 * third + (x / w) * third, H - 4 - (b / 255) * (H - 8), 18, 30, 80);
        }
      }
  } else if (kind === 'vectorscope') {
    const cx = W / 2;
    const cy = H / 2;
    const rad = H / 2 - 6;
    for (let i = 0; i < w * h; i++) {
      const r = (px[i * 4] ?? 0) / 255;
      const g = (px[i * 4 + 1] ?? 0) / 255;
      const b = (px[i * 4 + 2] ?? 0) / 255;
      const cb = -0.1146 * r - 0.3854 * g + 0.5 * b;
      const cr = 0.5 * r - 0.4542 * g - 0.0458 * b;
      add(cx + cb * rad * 1.8, cy - cr * rad * 1.8, 30, 60, 30);
    }
  } else {
    const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    for (let i = 0; i < w * h; i++)
      for (let c = 0; c < 3; c++) {
        const b = bins[c] as Uint32Array;
        const v = px[i * 4 + c] ?? 0;
        b[v] = (b[v] ?? 0) + 1;
      }
    const most = Math.max(1, ...bins.flatMap((b) => [...b].slice(2, 254)));
    for (let c = 0; c < 3; c++) {
      const b = bins[c] as Uint32Array;
      for (let v = 0; v < 256; v++) {
        const bar = Math.min(1, (b[v] ?? 0) / most) * (H - 8);
        for (let y = 0; y < bar; y++) add((v / 255) * (W - 1), H - 4 - y, c === 0 ? 90 : 0, c === 1 ? 90 : 0, c === 2 ? 90 : 0);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  // Guides.
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '10px Consolas, monospace';
  if (kind === 'vectorscope') {
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, H / 2 - 6, 0, Math.PI * 2);
    ctx.stroke();
    // The skin tone line.
    ctx.beginPath();
    ctx.moveTo(W / 2, H / 2);
    const a = (-123 * Math.PI) / 180;
    ctx.lineTo(W / 2 + Math.cos(a) * (H / 2 - 6), H / 2 + Math.sin(a) * (H / 2 - 6));
    ctx.stroke();
  } else if (kind !== 'histogram') {
    for (const v of [0, 25, 50, 75, 100]) {
      const y = H - 4 - (v / 100) * (H - 8);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.fillText(String(v), 2, y - 2);
    }
  }
}
