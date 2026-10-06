// Pro motion and timing in the Inspector: the keyframe graph editor, time
// remapping (speed ramps, freezes, backwards parts, frame blending and
// optical flow), motion blur, text animators and shape layers.
import { Plus, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { isAnim } from '../model/anim';
import { withLinked } from '../model/edit';
import { effectDef } from '../model/effects';
import { addFreeze, addRamp, addReverse, disableRemap, enableRemap, remapSpan, SAMPLINGS } from '../model/remap';
import { current, rate } from '../model/seq';
import { SHAPE_KINDS } from '../model/shapes';
import { TEXT_ANIMATOR_PRESETS, textAnimatorPreset } from '../model/textanim';
import type { Clip, MotionBlur, Param, ShapeData, TextAnimator, TextData, TimeRemap } from '../model/types';
import type { Doc } from '../doc';
import type { Actions } from './actions';
import { Choice, ColorField, ParamRow, Scrub, Section } from './controls';
import { GraphEditor } from './GraphEditor';
import './promotion.css';

type Upd = (c: Clip, label: string, f: (c: Clip) => Clip, final?: boolean, key?: string) => void;

interface Prop {
  id: string;
  label: string;
  def: number;
  get: (c: Clip) => Param | undefined;
  set: (c: Clip, p: Param) => Clip;
}

const MOTION: [string, string, number][] = [
  ['x', 'Position ↔', 0],
  ['y', 'Position ↕', 0],
  ['scale', 'Scale', 100],
  ['scaleX', 'Width', 100],
  ['rotation', 'Rotation', 0],
  ['opacity', 'Opacity', 100],
  ['rotX', 'Tilt ↕', 0],
  ['rotY', 'Turn ↔', 0],
  ['z', 'Depth', 0],
  ['cropL', 'Crop left', 0],
  ['cropR', 'Crop right', 0],
  ['cropT', 'Crop top', 0],
  ['cropB', 'Crop bottom', 0],
];

const ANIMATOR_PROPS: [keyof TextAnimator, string, number][] = [
  ['start', 'Start', 0],
  ['end', 'End', 100],
  ['offset', 'Offset', 0],
  ['amount', 'Amount', 100],
  ['opacity', 'Opacity', 100],
  ['x', 'Position ↔', 0],
  ['y', 'Position ↕', 0],
  ['scale', 'Scale', 100],
  ['rotation', 'Rotation', 0],
  ['blur', 'Blur', 0],
  ['tracking', 'Tracking', 0],
];

const withText = (c: Clip, f: (t: TextData) => TextData): Clip => (c.source.kind === 'text' ? { ...c, source: { ...c.source, text: f(c.source.text) } } : c);
const withShape = (c: Clip, f: (s: ShapeData) => ShapeData): Clip =>
  c.source.kind === 'shape' ? { ...c, source: { ...c.source, shape: f(c.source.shape) } } : c;
const setAnimator = (c: Clip, id: string, f: (a: TextAnimator) => TextAnimator): Clip =>
  withText(c, (t) => ({ ...t, animators: (t.animators ?? []).map((a) => (a.id === id ? f(a) : a)) }));

/** Every property of a clip that can have keyframes, for the graph editor. */
export function clipProps(c: Clip): Prop[] {
  const out: Prop[] = MOTION.map(([k, label, def]) => ({
    id: `motion.${k}`,
    label,
    def,
    get: (x) => x.motion[k as 'x'] as Param | undefined,
    set: (x, p) => ({ ...x, motion: { ...x.motion, [k]: p } }),
  }));
  if (c.remap)
    out.push({
      id: 'remap.speed',
      label: 'Speed (time remapping)',
      def: 100,
      get: (x) => x.remap?.speed,
      set: (x, p) => (x.remap ? { ...x, remap: { ...x.remap, speed: p } } : x),
    });
  for (const e of c.effects) {
    const def = effectDef(e.type);
    for (const pd of def?.params ?? []) {
      if (pd.still || pd.toggle || pd.options) continue;
      out.push({
        id: `fx.${e.id}.${pd.key}`,
        label: `${def?.name ?? e.type}: ${pd.label}`,
        def: pd.def,
        get: (x) => x.effects.find((y) => y.id === e.id)?.p[pd.key],
        set: (x, p) => ({ ...x, effects: x.effects.map((y) => (y.id === e.id ? { ...y, p: { ...y.p, [pd.key]: p } } : y)) }),
      });
    }
  }
  if (c.source.kind === 'text')
    for (const a of c.source.text.animators ?? [])
      for (const [k, label, def] of ANIMATOR_PROPS)
        out.push({
          id: `ta.${a.id}.${k}`,
          label: `${a.name}: ${label}`,
          def,
          get: (x) => (x.source.kind === 'text' ? (x.source.text.animators?.find((y) => y.id === a.id)?.[k] as Param | undefined) : undefined),
          set: (x, p) => setAnimator(x, a.id, (y) => ({ ...y, [k]: p })),
        });
  if (c.source.kind === 'shape')
    for (const [k, label, def] of [
      ['trimStart', 'Trim start', 0],
      ['trimEnd', 'Trim end', 100],
      ['trimOffset', 'Trim offset', 0],
    ] as const)
      out.push({
        id: `shape.${k}`,
        label,
        def,
        get: (x) => (x.source.kind === 'shape' ? x.source.shape[k] : undefined),
        set: (x, p) => withShape(x, (s) => ({ ...s, [k]: p })),
      });
  out.push(
    { id: 'gain', label: 'Volume', def: 0, get: (x) => x.gain, set: (x, p) => ({ ...x, gain: p }) },
    { id: 'pan', label: 'Pan', def: 0, get: (x) => x.pan, set: (x, p) => ({ ...x, pan: p }) },
  );
  return out;
}

export function ProMotionSections({
  doc,
  actions,
  clip,
  local,
  isVideo,
  onSeek,
  upd,
}: {
  doc: Doc;
  actions: Actions;
  clip: Clip;
  local: number;
  isVideo: boolean;
  onSeek: (frame: number) => void;
  upd: Upd;
}) {
  const fps = rate(current(doc.project));
  const timed = clip.source.kind === 'media' || clip.source.kind === 'multicam' || clip.source.kind === 'sequence';
  return (
    <>
      {clip.source.kind === 'shape' && <ShapeSection clip={clip} local={local} onSeek={onSeek} upd={upd} />}
      {clip.source.kind === 'text' && <TextAnimatorsSection clip={clip} local={local} fps={fps} onSeek={onSeek} upd={upd} />}
      {timed && <TimeRemapSection doc={doc} actions={actions} clip={clip} local={local} fps={fps} onSeek={onSeek} />}
      {isVideo && clip.source.kind !== 'adjustment' && <MotionBlurSection clip={clip} upd={upd} />}
      <GraphSection clip={clip} local={local} fps={fps} onSeek={onSeek} upd={upd} />
    </>
  );
}

function GraphSection({ clip, local, fps, onSeek, upd }: { clip: Clip; local: number; fps: number; onSeek: (f: number) => void; upd: Upd }) {
  const props = clipProps(clip);
  const animated = props.filter((p) => isAnim(p.get(clip)));
  const [pick, setPick] = useState<string | null>(null);
  const prop = props.find((p) => p.id === pick) ?? animated[0] ?? props[0];
  if (!prop) return null;
  return (
    <Section title="Graph editor" open={animated.length > 0}>
      <div className="insp__row">
        <span className="field__label">Property</span>
        <select className="text text--sm" value={prop.id} aria-label="Property to show in the graph" onChange={(e) => setPick(e.target.value)}>
          {animated.length > 0 && (
            <optgroup label="Animated">
              {animated.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="All">
            {props
              .filter((p) => !animated.includes(p))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
          </optgroup>
        </select>
      </div>
      <GraphEditor
        param={prop.get(clip)}
        def={prop.def}
        label={prop.label}
        fps={fps}
        length={clip.length}
        local={local}
        onSeek={(f) => onSeek(clip.start + f)}
        onChange={(p, final) => upd(clip, `Keyframes: ${prop.label}`, (c) => prop.set(c, p), final, `graph-${clip.id}-${prop.id}`)}
      />
    </Section>
  );
}

function MotionBlurSection({ clip, upd }: { clip: Clip; upd: Upd }) {
  const mb: MotionBlur = clip.motionBlur ?? { on: false, shutter: 180, samples: 8 };
  const set = (change: Partial<MotionBlur>, final = true) =>
    upd(clip, 'Motion blur', (c) => ({ ...c, motionBlur: { ...mb, ...change } }), final, `mb-${clip.id}`);
  return (
    <Section title="Motion blur" open={mb.on}>
      <label className="check">
        <input type="checkbox" checked={mb.on} onChange={(e) => set({ on: e.target.checked })} /> Blur what moves (animated position, size and turn)
      </label>
      {mb.on && (
        <>
          <div className="insp__row">
            <span className="field__label">Shutter angle</span>
            <Scrub value={mb.shutter} min={0} max={720} step={1} unit="°" label="Shutter angle" onChange={(v, final) => set({ shutter: v }, final)} />
            {[90, 180, 360].map((a) => (
              <button key={a} type="button" className="btn btn--sm" onClick={() => set({ shutter: a })}>
                {a}°
              </button>
            ))}
          </div>
          <div className="insp__row">
            <span className="field__label">Samples</span>
            <Scrub value={mb.samples} min={2} max={32} step={1} label="Samples" onChange={(v, final) => set({ samples: v }, final)} />
          </div>
          <p className="insp__note">180° is the film look (the shutter open half of each frame). More samples are smoother and slower to draw.</p>
        </>
      )}
    </Section>
  );
}

function TimeRemapSection({
  doc,
  actions,
  clip,
  local,
  fps,
  onSeek,
}: {
  doc: Doc;
  actions: Actions;
  clip: Clip;
  local: number;
  fps: number;
  onSeek: (f: number) => void;
}) {
  const [len, setLen] = useState(1);
  const [rampTo, setRampTo] = useState(25);
  const r = clip.remap;
  // Picture and sound remap together.
  const ids = withLinked(current(doc.project), [clip.id]);
  const change = (label: string, f: (c: Clip) => Clip, key?: string) => actions.update(ids, label, f, key);
  const remapOf = (f: (r: TimeRemap, c: Clip) => TimeRemap) => (c: Clip) => (c.remap ? { ...c, remap: f(c.remap, c) } : c);
  const frames = Math.max(1, Math.round(len * fps));
  const span = r ? remapSpan(r, clip.length) : null;
  return (
    <Section title="Time remapping" open={!!r}>
      {!r ? (
        <>
          <p className="insp__note">
            Change the speed over the clip with keyframes: speed ramps, freeze frames and parts played backwards, with smooth slow motion.
          </p>
          <button type="button" className="btn btn--sm" onClick={() => change('Time remapping on', (c) => enableRemap(c, fps))}>
            Turn on time remapping
          </button>
        </>
      ) : (
        <>
          <ParamRow
            label="Speed"
            param={r.speed}
            local={local}
            def={100}
            min={-400}
            max={400}
            step={1}
            unit="%"
            clipStart={clip.start}
            onSeek={onSeek}
            onChange={(p, final) =>
              change(
                'Speed',
                remapOf((x) => ({ ...x, speed: p })),
                final ? undefined : `remap-${clip.id}`,
              )
            }
          />
          <div className="insp__row">
            <span className="field__label">In-between frames</span>
            <Choice
              value={r.sampling}
              options={SAMPLINGS}
              onChange={(v) =>
                change(
                  'Frame sampling',
                  remapOf((x) => ({ ...x, sampling: v })),
                )
              }
              label="Frame sampling"
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={r.pitch}
              onChange={(e) =>
                change(
                  'Sound pitch',
                  remapOf((x) => ({ ...x, pitch: e.target.checked })),
                )
              }
            />{' '}
            Keep the sound’s pitch
          </label>
          <div className="insp__row">
            <span className="field__label">Length</span>
            <Scrub
              value={len}
              min={1 / fps}
              max={30}
              step={1 / fps}
              decimals={2}
              unit="s"
              label="Length of a freeze, backwards part or ramp"
              onChange={(v) => setLen(v)}
            />
          </div>
          <div className="insp__row promo__btns">
            <button
              type="button"
              className="btn btn--sm"
              title="Hold the picture at the playhead"
              onClick={() =>
                change(
                  'Freeze frame',
                  remapOf((x) => addFreeze(x, local, frames)),
                )
              }
            >
              Freeze frame
            </button>
            <button
              type="button"
              className="btn btn--sm"
              title="Play backwards from the playhead"
              onClick={() =>
                change(
                  'Play backwards',
                  remapOf((x, c) => addReverse(x, local, frames, c.length)),
                )
              }
            >
              Backwards
            </button>
            <button
              type="button"
              className="btn btn--sm"
              title="Ease into a new speed from the playhead"
              onClick={() =>
                change(
                  'Speed ramp',
                  remapOf((x, c) => addRamp(x, local, frames, rampTo, c.length)),
                )
              }
            >
              Ramp to
            </button>
            <Scrub value={rampTo} min={-400} max={400} step={1} unit="%" label="Speed the ramp reaches" onChange={(v) => setRampTo(v)} />
          </div>
          <p className="insp__note">
            Uses {span ? `${(((span.max - span.min) * clip.speed) / fps).toFixed(2)} s` : ''} of the file. Optical flow makes new frames between the file’s own
            for smooth slow motion (slower to draw); the sound follows the speed.
          </p>
          <button type="button" className="btn btn--sm" onClick={() => change('Time remapping off', disableRemap)}>
            Turn off time remapping
          </button>
        </>
      )}
    </Section>
  );
}

function TextAnimatorsSection({ clip, local, fps, onSeek, upd }: { clip: Clip; local: number; fps: number; onSeek: (f: number) => void; upd: Upd }) {
  const [preset, setPreset] = useState('typewriter');
  if (clip.source.kind !== 'text') return null;
  const list = clip.source.text.animators ?? [];
  const add = () => {
    const frames = Math.max(2, Math.min(Math.round(fps * 1.2), Math.floor(clip.length / 2)));
    upd(clip, 'Add text animator', (c) => withText(c, (t) => ({ ...t, animators: [...(t.animators ?? []), textAnimatorPreset(preset, frames)] })));
  };
  return (
    <Section title="Text animators" open={list.length > 0}>
      <div className="insp__row">
        <select className="text text--sm" value={preset} aria-label="Text animator preset" onChange={(e) => setPreset(e.target.value)}>
          {TEXT_ANIMATOR_PRESETS.map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn--sm" onClick={add}>
          <Plus />
          Add animator
        </button>
      </div>
      {list.map((a) => (
        <AnimatorEditor key={a.id} clip={clip} a={a} local={local} onSeek={onSeek} upd={upd} />
      ))}
      {!list.length && <p className="insp__note">Animate letters, words or lines one after another. Each animator’s range picks which, and how much.</p>}
    </Section>
  );
}

function AnimatorEditor({ clip, a, local, onSeek, upd }: { clip: Clip; a: TextAnimator; local: number; onSeek: (f: number) => void; upd: Upd }) {
  const set = (change: Partial<TextAnimator>, final = true, key?: string) =>
    upd(clip, 'Text animator', (c) => setAnimator(c, a.id, (x) => ({ ...x, ...change })), final, key ?? `ta-${a.id}`);
  const row = (k: keyof TextAnimator, label: string, def: number, min: number, max: number, unit?: string) => (
    <ParamRow
      key={k}
      label={label}
      param={a[k] as Param | undefined}
      local={local}
      def={def}
      min={min}
      max={max}
      step={k === 'scale' || k === 'opacity' || k === 'start' || k === 'end' || k === 'offset' || k === 'amount' ? 1 : 0.5}
      unit={unit}
      clipStart={clip.start}
      onSeek={onSeek}
      onChange={(p, final) => set({ [k]: p }, final, `ta-${a.id}-${k}`)}
    />
  );
  return (
    <Box
      title={
        <input
          className="text text--sm promo__name"
          value={a.name}
          aria-label="Animator name"
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => set({ name: e.target.value }, false, `ta-name-${a.id}`)}
        />
      }
      actions={
        <>
          <label className="check">
            <input type="checkbox" checked={a.on} onChange={(e) => set({ on: e.target.checked })} /> On
          </label>
          <button
            type="button"
            className="btn btn--sm"
            aria-label="Remove animator"
            onClick={() =>
              upd(clip, 'Remove text animator', (c) => withText(c, (t) => ({ ...t, animators: (t.animators ?? []).filter((x) => x.id !== a.id) })))
            }
          >
            <X />
          </button>
        </>
      }
    >
      <div className="insp__row">
        <span className="field__label">By</span>
        <Choice
          value={a.by}
          options={[
            ['char', 'Letter'],
            ['word', 'Word'],
            ['line', 'Line'],
          ]}
          onChange={(v) => set({ by: v })}
          label="Animate by"
        />
      </div>
      <div className="insp__row">
        <span className="field__label">Shape</span>
        <select className="text text--sm" value={a.shape} aria-label="Range shape" onChange={(e) => set({ shape: e.target.value as TextAnimator['shape'] })}>
          <option value="square">Square</option>
          <option value="rampUp">Ramp up</option>
          <option value="rampDown">Ramp down</option>
          <option value="triangle">Triangle</option>
          <option value="round">Round</option>
          <option value="smooth">Smooth</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={!!a.hard} onChange={(e) => set({ hard: e.target.checked })} /> Whole units
        </label>
        <label className="check">
          <input type="checkbox" checked={!!a.reverse} onChange={(e) => set({ reverse: e.target.checked })} /> From the end
        </label>
      </div>
      {row('start', 'Range start', 0, 0, 100, '%')}
      {row('end', 'Range end', 100, 0, 100, '%')}
      {row('offset', 'Range offset', 0, -100, 100, '%')}
      {row('amount', 'Amount', 100, 0, 100, '%')}
      {row('opacity', 'Opacity', 100, 0, 100, '%')}
      {row('x', 'Position ↔', 0, -2000, 2000, 'px')}
      {row('y', 'Position ↕', 0, -2000, 2000, 'px')}
      {row('scale', 'Scale', 100, 0, 500, '%')}
      {row('rotation', 'Rotation', 0, -360, 360, '°')}
      {row('blur', 'Blur', 0, 0, 100, 'px')}
      {row('tracking', 'Tracking', 0, -50, 200, 'px')}
    </Box>
  );
}

function Box({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="promo__box">
      <div className="promo__boxhead">
        {title}
        <span className="promo__boxacts">{actions}</span>
      </div>
      {children}
    </div>
  );
}

function ShapeSection({ clip, local, onSeek, upd }: { clip: Clip; local: number; onSeek: (f: number) => void; upd: Upd }) {
  if (clip.source.kind !== 'shape') return null;
  const s = clip.source.shape;
  const set = (change: Partial<ShapeData>, final = true, key?: string) =>
    upd(clip, 'Shape', (c) => withShape(c, (x) => ({ ...x, ...change })), final, key ?? `shape-${clip.id}`);
  const num = (k: keyof ShapeData, label: string, min: number, max: number, step = 1, unit = '') => (
    <div className="insp__row" key={k}>
      <span className="field__label">{label}</span>
      <Scrub
        value={s[k] as number}
        min={min}
        max={max}
        step={step}
        unit={unit}
        label={label}
        onChange={(v, final) => set({ [k]: v }, final, `shape-${clip.id}-${k}`)}
      />
    </div>
  );
  const trim = (k: 'trimStart' | 'trimEnd' | 'trimOffset', label: string, def: number, min: number, max: number) => (
    <ParamRow
      key={k}
      label={label}
      param={s[k]}
      local={local}
      def={def}
      min={min}
      max={max}
      step={0.5}
      unit="%"
      clipStart={clip.start}
      onSeek={onSeek}
      onChange={(p, final) => set({ [k]: p }, final, `shape-${clip.id}-${k}`)}
    />
  );
  return (
    <Section title="Shape">
      <div className="insp__row">
        <Choice value={s.kind} options={SHAPE_KINDS} onChange={(v) => set({ kind: v, ...(v === 'line' ? { strokeOn: true } : {}) })} label="Shape" />
      </div>
      {num('w', s.kind === 'line' ? 'Length' : 'Width', 1, 8000, 1, 'px')}
      {s.kind !== 'line' && num('h', 'Height', 1, 8000, 1, 'px')}
      {num('px', 'Across', -1, 2, 0.005)}
      {num('py', 'Down', -1, 2, 0.005)}
      {(s.kind === 'polygon' || s.kind === 'star') && num('sides', s.kind === 'star' ? 'Points' : 'Sides', 3, 64)}
      {s.kind === 'star' && num('inner', 'Inner radius', 1, 100, 1, '%')}
      {(s.kind === 'rect' || s.kind === 'polygon' || s.kind === 'star') && num('corner', 'Rounded corners', 0, 2000, 1, 'px')}
      {s.kind !== 'line' && (
        <div className="insp__row">
          <label className="check">
            <input type="checkbox" checked={s.fillOn} onChange={(e) => set({ fillOn: e.target.checked })} /> Fill
          </label>
          <ColorField value={s.fill} label="Fill color" onChange={(v) => set({ fill: v }, false, `shape-fill-${clip.id}`)} />
        </div>
      )}
      <div className="insp__row">
        <label className="check">
          <input type="checkbox" checked={s.strokeOn} onChange={(e) => set({ strokeOn: e.target.checked })} /> Stroke
        </label>
        <ColorField value={s.stroke} label="Stroke color" onChange={(v) => set({ stroke: v }, false, `shape-stroke-${clip.id}`)} />
        <Scrub
          value={s.strokeWidth}
          min={0}
          max={400}
          step={0.5}
          unit="px"
          label="Stroke width"
          onChange={(v, final) => set({ strokeWidth: v }, final, `shape-sw-${clip.id}`)}
        />
      </div>
      {trim('trimStart', 'Trim start', 0, 0, 100)}
      {trim('trimEnd', 'Trim end', 100, 0, 100)}
      {trim('trimOffset', 'Trim offset', 0, -100, 100)}
      <p className="insp__note">Keyframe Trim end from 0 to 100% to draw the shape on.</p>
    </Section>
  );
}
