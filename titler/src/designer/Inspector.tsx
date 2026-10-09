// The properties of the selected layer (or the composition when nothing is
// selected): everything about it, in sections.

import { useEffect, useState, type ReactElement } from 'react';
import { exprProblem } from '../core/expr';
import { Plus, Trash2 } from 'lucide-react';
import { tokensFor, valuesFor, variablesIn } from '../core/binding';
import { uid } from '../core/build';
import { isAnimated, num, setValue, toggleKeys, valueAt, vec } from '../core/easing';
import { fade, grow, reveal, slide, wipe } from '../core/motion';
import { ellipsePath, rectPath } from '../core/paths';
import type { Effect, ImageLayer, VideoLayer, Layer, Mask, Paint, Prop, ShapeLayer, Stroke, TextAnimator, TextLayer, Value, Vec2 } from '../core/types';
import { ColorField, NumberField, Row, Section, Select, Toggle } from './fields';
import { layerBox } from './geometry';
import { lookOf } from './Viewport';
import { compOf, findLayer, flatLayers, setParent, updateLayers } from './ops';
import { EFFECT_NAMES, getProp, withProp } from './props';
import type { Store } from './store';
import { useStore } from './store';
import { loadStyles, saveStyle, styleOf, applyStyle, removeStyle } from './styles';
import { applyTextStyle, differsFromStyle, newTextStyle, styleFromLayer } from './textStyles';
import { inStackOrder, loadAnimPresets, pasteKeys, removeAnimPreset, saveAnimPreset, stagger } from './keyframes';

const FONTS = [
  '$font',
  '$fontSub',
  'Inter',
  'Segoe UI',
  'Arial',
  'Georgia',
  'Heebo',
  'Frank Ruhl Libre',
  'Bebas Neue',
  'Chakra Petch',
  'Times New Roman',
  'Verdana',
  'Tahoma',
  'Calibri',
  'Consolas',
];

export function Inspector({ store }: { store: Store }) {
  const project = useStore(store, (s) => s.project);
  const compId = useStore(store, (s) => s.compId);
  const selection = useStore(store, (s) => s.selection);
  const time = useStore(store, (s) => s.time);
  const values = useStore(store, (s) => s.values);
  const brand = useStore(store, (s) => s.brand);
  const c = compOf(project, compId);
  const l = selection[0] ? findLayer(c, selection[0]) : undefined;
  if (!l)
    return (
      <div className="tt-inspector-empty">
        <p>Nothing selected.</p>
        <p className="tt-dim">Click a layer on the canvas or in the timeline. The composition&rsquo;s own settings are in the Composition tab.</p>
      </div>
    );
  const tokens = tokensFor(project, brand ?? undefined);
  const vals = valuesFor(project, values);
  const fieldKeys = project.variables.map((v) => v.key);
  const upd = (label: string, fn: (x: Layer) => Layer) =>
    store.edit(label, (p) => updateLayers(p, c.id, selection.length > 1 && selection.includes(l.id) ? selection : [l.id], fn));
  const updOne = (label: string, fn: (x: Layer) => Layer) => store.edit(label, (p) => updateLayers(p, c.id, [l.id], fn));
  const prop = (path: string, label: string, fallback: Value, unit?: string, opt: { min?: number; max?: number; step?: number } = {}) => (
    <PropField store={store} layer={l} compId={c.id} path={path} label={label} fallback={fallback} time={time} unit={unit} {...opt} />
  );
  const updMedia = (label: string, fn: (x: ImageLayer | VideoLayer) => ImageLayer | VideoLayer) =>
    updOne(label, (x) => (x.type === 'image' || x.type === 'video' ? fn(x) : x));
  const others = flatLayers(c.layers).filter((x) => x.id !== l.id);
  return (
    <div className="tt-inspector" data-testid="titler-inspector">
      <Section title={selection.length > 1 ? `${selection.length} layers` : 'Layer'}>
        <Row label="Name">
          <input
            className="tt-input"
            value={l.name}
            onChange={(e) => updOne('Rename layer', (x) => ({ ...x, name: e.target.value }))}
            aria-label="Layer name"
          />
        </Row>
        <Row label="On screen" hint="When the layer starts and ends (seconds)">
          <NumberField
            value={l.start}
            step={1 / c.fps}
            min={0}
            max={l.end}
            label="Starts"
            unit="s"
            onChange={(v) => upd('Layer start', (x) => ({ ...x, start: v }))}
          />
          <NumberField
            value={l.end}
            step={1 / c.fps}
            min={l.start}
            max={c.duration}
            label="Ends"
            unit="s"
            onChange={(v) => upd('Layer end', (x) => ({ ...x, end: v }))}
          />
        </Row>
        <Row label="Parent" hint="Moves, turns and scales with another layer">
          <select
            className="tt-select"
            aria-label="Parent layer"
            value={l.parent ?? ''}
            onChange={(e) => store.edit('Set parent', (p) => setParent(p, c.id, l.id, e.target.value || null, time))}
          >
            <option value="">None</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Track matte" hint="Seen only through another layer">
          <select
            className="tt-select"
            aria-label="Track matte layer"
            value={l.matte?.layer ?? ''}
            onChange={(e) => updOne('Track matte', (x) => ({ ...x, matte: e.target.value ? { layer: e.target.value, mode: x.matte?.mode ?? 'alpha' } : null }))}
          >
            <option value="">None</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {l.matte && (
            <Select
              label="Matte mode"
              value={l.matte.mode}
              options={[
                ['alpha', 'Alpha'],
                ['alphaInverted', 'Alpha inverted'],
                ['luma', 'Luma'],
                ['lumaInverted', 'Luma inverted'],
              ]}
              onChange={(mode) => updOne('Track matte', (x) => ({ ...x, matte: x.matte ? { ...x.matte, mode } : null }))}
            />
          )}
        </Row>
        <Row label="Constraints" hint="How the layer is placed in the title's other formats (9:16, 1:1, 4K): pinned, scaled or stretched">
          <Select
            label="Constraint across"
            value={l.constraints?.h ?? 'auto'}
            options={[
              ['auto', 'Auto'],
              ['left', 'Left'],
              ['center', 'Center'],
              ['right', 'Right'],
              ['scale', 'Scale'],
              ['stretch', 'Left and right'],
            ]}
            onChange={(h) => upd('Constraints', (x) => ({ ...x, constraints: { ...x.constraints, h: h === 'auto' ? undefined : h } }))}
          />
          <Select
            label="Constraint down"
            value={l.constraints?.v ?? 'auto'}
            options={[
              ['auto', 'Auto'],
              ['top', 'Top'],
              ['center', 'Center'],
              ['bottom', 'Bottom'],
              ['scale', 'Scale'],
              ['stretch', 'Top and bottom'],
            ]}
            onChange={(v) => upd('Constraints', (x) => ({ ...x, constraints: { ...x.constraints, v: v === 'auto' ? undefined : v } }))}
          />
        </Row>
        <Row label="Blend">
          <Select
            label="Blend mode"
            value={l.blend ?? 'normal'}
            options={[
              ['normal', 'Normal'],
              ['multiply', 'Multiply'],
              ['screen', 'Screen'],
              ['overlay', 'Overlay'],
              ['darken', 'Darken'],
              ['lighten', 'Lighten'],
              ['add', 'Add'],
            ]}
            onChange={(blend) => upd('Blend mode', (x) => ({ ...x, blend }))}
          />
        </Row>
      </Section>

      <Section title="Transform">
        {prop('transform.position', 'Position', [0, 0], 'px')}
        {prop('transform.scale', 'Scale', [100, 100], '%')}
        {prop('transform.rotation', 'Rotation', 0, '°')}
        {prop('transform.opacity', 'Opacity', 100, '%', { min: 0, max: 100 })}
        {prop('transform.anchor', 'Anchor point', [0, 0], 'px')}
        <div className="tt-btnrow">
          <button
            onClick={() => {
              const b = layerBox(lookOf(store.get()), l);
              const a = vec(l.transform.anchor, time, [0, 0]);
              const pos = vec(l.transform.position, time, [0, 0]);
              const na: Vec2 = [b.x + b.w / 2, b.y + b.h / 2];
              // Keep it where it is: the position moves by the same amount (unscaled, unturned).
              updOne('Center anchor point', (x) => ({
                ...x,
                transform: {
                  ...x.transform,
                  anchor: { v: na },
                  position: isAnimated(x.transform.position) ? x.transform.position : { v: [pos[0] + na[0] - a[0], pos[1] + na[1] - a[1]] },
                },
              }));
            }}
          >
            Center anchor point
          </button>
        </div>
      </Section>

      {l.type === 'text' && <TextSection store={store} l={l} compId={c.id} fieldKeys={fieldKeys} tokens={tokens} vals={vals} time={time} />}
      {l.type === 'text' && <AnimatorSection store={store} l={l} compId={c.id} />}
      {l.type === 'shape' && (
        <ShapeSection
          store={store}
          l={l}
          compId={c.id}
          fieldKeys={fieldKeys}
          tokens={tokens}
          vals={vals}
          time={time}
          prop={prop}
          texts={others.filter((o): o is TextLayer => o.type === 'text')}
        />
      )}
      {(l.type === 'image' || l.type === 'video') && (
        <Section title={l.type === 'image' ? 'Picture' : 'Video'}>
          <Row label="Shows">
            <select
              className="tt-select"
              aria-label="Picture"
              value={l.asset}
              onChange={(e) => updOne('Change picture', (x) => ({ ...x, asset: e.target.value }))}
            >
              {project.assets
                .filter((a) => (l.type === 'image' ? a.kind === 'image' || a.kind === 'svg' : a.kind === 'video' || a.kind === 'sequence'))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              {project.variables
                .filter((v) => v.type === 'image')
                .map((v) => (
                  <option key={v.key} value={`{{${v.key}}}`}>
                    Field: {v.label}
                  </option>
                ))}
              {!project.assets.some((a) => a.id === l.asset) && !l.asset.startsWith('{{') && (
                <option value={l.asset}>{l.asset ? 'Linked file' : 'Nothing'}</option>
              )}
            </select>
          </Row>
          <Row label="Size">
            <NumberField value={l.size[0]} label="Width" unit="px" onChange={(v) => updMedia('Picture size', (x) => ({ ...x, size: [v, x.size[1]] }))} />
            <NumberField value={l.size[1]} label="Height" unit="px" onChange={(v) => updMedia('Picture size', (x) => ({ ...x, size: [x.size[0], v] }))} />
          </Row>
          <Row label="Fit">
            <Select
              label="Fit"
              value={l.fit}
              options={[
                ['contain', 'Fit inside'],
                ['cover', 'Fill (crop)'],
                ['stretch', 'Stretch'],
              ]}
              onChange={(fit) => updMedia('Picture fit', (x) => ({ ...x, fit }))}
            />
          </Row>
          {l.type === 'video' && (
            <>
              <Toggle value={l.loop} onChange={(loop) => updOne('Loop video', (x) => ({ ...x, loop }))} label="Loop" />
              <Row label="Starts at">
                <NumberField
                  value={l.offset}
                  step={0.04}
                  min={0}
                  label="Video start"
                  unit="s"
                  onChange={(offset) => updOne('Video start', (x) => ({ ...x, offset }))}
                />
              </Row>
            </>
          )}
        </Section>
      )}
      {l.type === 'comp' && (
        <Section title="Composition">
          <Row label="Shows">
            <select
              className="tt-select"
              aria-label="Composition shown"
              value={l.comp}
              onChange={(e) => updOne('Change composition', (x) => ({ ...x, comp: e.target.value }))}
            >
              {project.compositions
                .filter((x) => x.id !== c.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </Row>
          <Row label="Time offset">
            <NumberField
              value={l.offset}
              step={1 / c.fps}
              label="Time offset"
              unit="s"
              onChange={(offset) => updOne('Time offset', (x) => ({ ...x, offset }))}
            />
          </Row>
          <button className="tt-link" onClick={() => store.set({ compId: l.comp, selection: [] })}>
            Open this composition
          </button>
        </Section>
      )}

      <Section title="Wipe and blur" open={!!l.reveal || !!l.blur}>
        {l.reveal ? (
          <>
            {prop('reveal.left', 'From left', 0, '%', { min: 0, max: 100 })}
            {prop('reveal.right', 'From right', 0, '%', { min: 0, max: 100 })}
            {prop('reveal.top', 'From top', 0, '%', { min: 0, max: 100 })}
            {prop('reveal.bottom', 'From bottom', 0, '%', { min: 0, max: 100 })}
            <button className="tt-link" onClick={() => updOne('Remove wipe', (x) => ({ ...x, reveal: undefined }))}>
              Remove wipe
            </button>
          </>
        ) : (
          <button
            className="tt-link"
            onClick={() => updOne('Add wipe', (x) => ({ ...x, reveal: { left: { v: 0 }, right: { v: 0 }, top: { v: 0 }, bottom: { v: 0 } } }))}
          >
            Add a wipe (crop each side)
          </button>
        )}
        {prop('blur', 'Blur', 0, 'px', { min: 0 })}
      </Section>

      <MotionPresets store={store} l={l} compId={c.id} />
      <MaskSection store={store} l={l} compId={c.id} time={time} />
      <EffectSection store={store} l={l} compId={c.id} tokens={tokens} vals={vals} fieldKeys={fieldKeys} />
      <StyleSection store={store} l={l} compId={c.id} />
    </div>
  );
}

/** One animatable property: its value now, and the stopwatch. */
function PropField({
  store,
  layer,
  compId,
  path,
  label,
  fallback,
  time,
  unit,
  min,
  max,
  step = 1,
}: {
  store: Store;
  layer: Layer;
  compId: string;
  path: string;
  label: string;
  fallback: Value;
  time: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const p = getProp(layer, path);
  const anim = isAnimated(p);
  const v = valueAt(p as never, time, fallback as never) as Value;
  const expr = p?.x;
  const [exprOpen, setExprOpen] = useState(false);
  const set = (nv: Value) =>
    store.edit(`Change ${label.toLowerCase()}`, (pr) =>
      updateLayers(pr, compId, [layer.id], (x) => withProp(x, path, setValue(getProp(x, path) as never, time, nv as never))),
    );
  const setExpr = (x: string | null) =>
    store.edit(x === null ? `Remove expression from ${label.toLowerCase()}` : `Expression on ${label.toLowerCase()}`, (pr) =>
      updateLayers(pr, compId, [layer.id], (l) => {
        const cur = (getProp(l, path) ?? { v: fallback }) as Prop<Value>;
        const { x: _old, ...rest } = cur;
        return withProp(l, path, (x === null ? rest : { ...rest, x }) as never);
      }),
    );
  return (
    <>
      <Row label={label}>
        <button
          className={`tt-ico stopwatch${anim ? ' on' : ''}`}
          onClick={() =>
            store.edit(anim ? 'Remove keyframes' : 'Add keyframes', (pr) =>
              updateLayers(pr, compId, [layer.id], (x) => withProp(x, path, toggleKeys(getProp(x, path) as never, time, fallback as never))),
            )
          }
          title={anim ? 'Animated: click to stop animating' : 'Animate this (a keyframe at the playhead)'}
          aria-label={`Animate ${label}`}
          aria-pressed={anim}
        >
          ◆
        </button>
        {Array.isArray(v) ? (
          <>
            <NumberField
              value={v[0]}
              step={step}
              label={`${label} x`}
              unit={unit}
              onChange={(n) => set([n, v[1]])}
              onBegin={() => store.begin(label)}
              onEnd={() => store.end()}
            />
            <NumberField
              value={v[1]}
              step={step}
              label={`${label} y`}
              unit={unit}
              onChange={(n) => set([v[0], n])}
              onBegin={() => store.begin(label)}
              onEnd={() => store.end()}
            />
          </>
        ) : (
          <NumberField
            value={v}
            step={step}
            min={min}
            max={max}
            label={label}
            unit={unit}
            onChange={(n) => set(n)}
            onBegin={() => store.begin(label)}
            onEnd={() => store.end()}
            wide
          />
        )}
        <button
          className={`tt-ico tt-expr-btn${expr ? ' on' : ''}`}
          onClick={() => setExprOpen(!exprOpen && !expr ? true : !exprOpen)}
          title={expr ? `Expression: ${expr}` : 'Add an expression (wiggle, loop, time, a link to another layer)'}
          aria-label={`Expression for ${label}`}
          aria-pressed={!!expr}
        >
          =
        </button>
      </Row>
      {(exprOpen || !!expr) && <ExprEditor label={label} value={expr ?? ''} open={exprOpen} onOpen={setExprOpen} onChange={setExpr} />}
    </>
  );
}

const EXPR_EXAMPLES: [string, string][] = [
  ['wiggle(2, 8)', 'Shake: 2 times a second, 8 px'],
  ['loopOut()', 'Repeat the keyframes'],
  ['loopOut("pingpong")', 'Back and forth'],
  ['time * 90', 'Keep turning (90° a second)'],
  ['value + [0, sin(time * 3) * 10]', 'Float up and down'],
];

/** An expression under a property: type it, see if it works, pick an example. */
function ExprEditor({
  label,
  value,
  open,
  onOpen,
  onChange,
}: {
  label: string;
  value: string;
  open: boolean;
  onOpen: (o: boolean) => void;
  onChange: (x: string | null) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const problem = text.trim() ? exprProblem(text) : null;
  if (!open)
    return (
      <div className="tt-expr tt-expr-closed">
        <button className="tt-expr-code" onClick={() => onOpen(true)} title="Change the expression">
          = {value}
        </button>
      </div>
    );
  const commit = () => {
    if (!text.trim()) onChange(null);
    else if (!problem && text !== value) onChange(text.trim());
  };
  return (
    <div className="tt-expr">
      <input
        className="tt-input tt-expr-input"
        autoFocus
        value={text}
        placeholder="wiggle(2, 8)"
        aria-label={`${label} expression`}
        aria-invalid={!!problem}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            onOpen(false);
          }
          if (e.key === 'Escape') {
            setText(value);
            onOpen(false);
          }
        }}
      />
      {problem ? <div className="tt-expr-problem">{problem}</div> : null}
      <div className="tt-chips">
        {EXPR_EXAMPLES.map(([x, hint]) => (
          <button key={x} className="tt-chip" title={hint} onMouseDown={(e) => e.preventDefault()} onClick={() => (setText(x), onChange(x))}>
            {x}
          </button>
        ))}
        {value && (
          <button className="tt-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => (onChange(null), onOpen(false))}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

interface Common {
  store: Store;
  compId: string;
}

function PaintField({
  paint,
  onChange,
  label,
  tokens,
  vals,
  fieldKeys,
}: {
  paint: Paint;
  onChange: (p: Paint) => void;
  label: string;
  tokens: ReturnType<typeof tokensFor>;
  vals: Record<string, string>;
  fieldKeys: string[];
}) {
  return (
    <>
      <Row label={label}>
        <Select
          label={`${label} kind`}
          value={paint.type}
          options={[
            ['solid', 'Color'],
            ['linear', 'Linear gradient'],
            ['radial', 'Radial gradient'],
          ]}
          onChange={(type) => {
            const first = paint.type === 'solid' ? paint.color : (paint.stops[0]?.color ?? '$box');
            if (type === 'solid') onChange({ type, color: first });
            else
              onChange({
                type,
                angle: 90,
                stops: [
                  { at: 0, color: first },
                  { at: 1, color: '$boxAlt' },
                ],
              } as Paint);
          }}
        />
      </Row>
      {paint.type === 'solid' ? (
        <Row label="">
          <ColorField
            value={paint.color}
            onChange={(color) => onChange({ type: 'solid', color })}
            tokens={tokens}
            values={vals}
            label={label}
            fields={fieldKeys}
          />
        </Row>
      ) : (
        <>
          {paint.type === 'linear' && (
            <Row label="Angle">
              <NumberField value={paint.angle} label="Gradient angle" unit="°" onChange={(angle) => onChange({ ...paint, angle })} />
            </Row>
          )}
          {paint.stops.map((s, i) => (
            <Row key={i} label={`Stop ${i + 1}`}>
              <NumberField
                value={Math.round(s.at * 100)}
                min={0}
                max={100}
                label={`Stop ${i + 1} position`}
                unit="%"
                onChange={(at) => onChange({ ...paint, stops: paint.stops.map((x, j) => (j === i ? { ...x, at: at / 100 } : x)) })}
              />
              <ColorField
                value={s.color}
                onChange={(color) => onChange({ ...paint, stops: paint.stops.map((x, j) => (j === i ? { ...x, color } : x)) })}
                tokens={tokens}
                values={vals}
                label={`Stop ${i + 1}`}
                fields={fieldKeys}
              />
            </Row>
          ))}
          <button className="tt-link" onClick={() => onChange({ ...paint, stops: [...paint.stops, { at: 1, color: '$text' }] })}>
            Add a color stop
          </button>
        </>
      )}
    </>
  );
}

function TextSection({
  store,
  l,
  compId,
  fieldKeys,
  tokens,
  vals,
  time,
}: Common & { l: TextLayer; fieldKeys: string[]; tokens: ReturnType<typeof tokensFor>; vals: Record<string, string>; time: number }) {
  const editing = useStore(store, (s) => s.editingText === l.id);
  const upd = (label: string, fn: (x: TextLayer) => TextLayer) =>
    store.edit(label, (p) => updateLayers(p, compId, [l.id], (x) => (x.type === 'text' ? fn(x) : x)));
  const st = l.style;
  const style = (label: string, patch: Partial<TextLayer['style']>) => upd(label, (x) => ({ ...x, style: { ...x.style, ...patch } }));
  const missing = variablesIn(l.text).filter((k) => !fieldKeys.includes(k));
  void time;
  return (
    <Section title="Text">
      <TextStyleRow store={store} l={l} />
      <textarea
        className="tt-textarea"
        aria-label="Words"
        autoFocus={editing}
        value={l.text}
        rows={3}
        onChange={(e) =>
          upd('Edit text', (x) => ({
            ...x,
            text: e.target.value,
            name: x.name === 'Text' || x.name === x.text.slice(0, 30) ? e.target.value.replace(/\{\{|\}\}|\[[^\]]*\]/g, '').slice(0, 30) || 'Text' : x.name,
          }))
        }
        onBlur={() => store.set({ editingText: null })}
      />
      <div className="tt-chips">
        {fieldKeys.map((k) => (
          <button key={k} className="tt-chip" title={`Insert {{${k}}}`} onClick={() => upd('Insert field', (x) => ({ ...x, text: `${x.text}{{${k}}}` }))}>
            {`{{${k}}}`}
          </button>
        ))}
        {missing.length > 0 && (
          <button
            className="tt-chip warn"
            onClick={() =>
              store.edit('Add fields', (p) => ({
                ...p,
                variables: [
                  ...p.variables,
                  ...missing.map((k) => ({ key: k, label: k.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase()), type: 'text' as const, value: '' })),
                ],
              }))
            }
            title="These fields are used here but not in the Fields list yet"
          >
            Add {missing.map((m) => `{{${m}}}`).join(', ')} to fields
          </button>
        )}
      </div>
      <div className="tt-dim tt-small">
        Styling inside the words: [b]bold[/b], [i]italic[/i], [c=$accent]color[/c], [s=80]size[/s], [v=30]baseline shift[/v].
      </div>
      <Row label="Font">
        <input className="tt-input" list="tt-fonts" value={st.font} onChange={(e) => style('Font', { font: e.target.value })} aria-label="Font" />
        <datalist id="tt-fonts">
          {FONTS.map((f) => (
            <option key={f} value={f}>
              {f === '$font' ? `Event main font (${tokens.font})` : f === '$fontSub' ? `Event second font (${tokens.fontSub})` : f}
            </option>
          ))}
        </datalist>
      </Row>
      <Row label="Size">
        <NumberField value={st.size} min={1} label="Text size" unit="px" onChange={(size) => style('Text size', { size })} />
        <Select
          label="Weight"
          value={String(st.weight)}
          options={[
            ['300', 'Light'],
            ['400', 'Regular'],
            ['500', 'Medium'],
            ['600', 'Semibold'],
            ['700', 'Bold'],
            ['800', 'Extra bold'],
          ]}
          onChange={(w) => style('Weight', { weight: Number(w) })}
        />
      </Row>
      <Row label="Style">
        <Toggle value={st.italic} onChange={(italic) => style('Italic', { italic })} label="Italic" />
        <Toggle value={!!st.caps} onChange={(caps) => style('Capitals', { caps })} label="Capitals" />
        <Toggle value={!!st.smallCaps} onChange={(smallCaps) => style('Small capitals', { smallCaps })} label="Small caps" />
        <Toggle value={!!st.rtl} onChange={(rtl) => style('Right to left', { rtl, align: rtl ? 'right' : st.align })} label="Right to left" />
      </Row>
      <PaintField paint={st.fill} label="Fill" onChange={(fill) => style('Text color', { fill })} tokens={tokens} vals={vals} fieldKeys={fieldKeys} />
      <Row label="Outline">
        <Toggle
          value={!!st.stroke}
          onChange={(on) => style('Text outline', { stroke: on ? { paint: { type: 'solid', color: '$box' }, width: 2, join: 'round' } : null })}
          label="On"
        />
        {st.stroke && (
          <NumberField
            value={st.stroke.width}
            min={0}
            label="Outline width"
            unit="px"
            onChange={(width) => style('Outline width', { stroke: { ...st.stroke!, width } })}
          />
        )}
      </Row>
      {st.stroke && st.stroke.paint.type === 'solid' && (
        <Row label="">
          <ColorField
            value={st.stroke.paint.color}
            onChange={(color) => style('Outline color', { stroke: { ...st.stroke!, paint: { type: 'solid', color } } })}
            tokens={tokens}
            values={vals}
            label="Outline"
            fields={fieldKeys}
          />
        </Row>
      )}
      <Row label="Align">
        <Select
          label="Align"
          value={st.align}
          options={[
            ['left', 'Left'],
            ['center', 'Center'],
            ['right', 'Right'],
            ['justify', 'Justify'],
          ]}
          onChange={(align) => style('Align', { align })}
        />
        <Select
          label="Vertical align"
          value={st.vAlign}
          options={[
            ['top', 'Top'],
            ['middle', 'Middle'],
            ['bottom', 'Bottom'],
          ]}
          onChange={(vAlign) => style('Vertical align', { vAlign })}
        />
      </Row>
      <Row label="Spacing">
        <NumberField value={st.tracking} step={0.5} label="Letter spacing" unit="px" onChange={(tracking) => style('Letter spacing', { tracking })} />
        <NumberField value={st.lineHeight} step={0.05} min={0.5} label="Line height" unit="×" onChange={(lineHeight) => style('Line height', { lineHeight })} />
      </Row>
      <Row label="Figures" hint="Tabular figures keep every digit the same width, so scores and clocks don't shift as they change.">
        <Select
          label="Figures"
          value={st.figures ?? 'proportional'}
          options={[
            ['proportional', 'Proportional'],
            ['tabular', 'Tabular (scores, clocks)'],
          ]}
          onChange={(figures) => style('Figures', { figures: figures === 'proportional' ? undefined : figures })}
        />
        <Select
          label="Kerning"
          value={st.kerning ?? 'auto'}
          options={[
            ['auto', 'Kerning: font'],
            ['none', 'Kerning: none'],
          ]}
          onChange={(kerning) => style('Kerning', { kerning: kerning === 'auto' ? undefined : kerning })}
        />
      </Row>
      <Row label="Box">
        <NumberField value={l.box[0]} min={0} label="Box width" unit="px" onChange={(w) => upd('Text box', (x) => ({ ...x, box: [w, x.box[1]] }))} />
        <NumberField value={l.box[1]} min={0} label="Box height" unit="px" onChange={(h) => upd('Text box', (x) => ({ ...x, box: [x.box[0], h] }))} />
      </Row>
      <Row label="Fitting">
        <Toggle value={l.wrap} onChange={(wrap) => upd('Wrap', (x) => ({ ...x, wrap }))} label="Wrap lines" />
        <Toggle value={l.fit === 'shrink'} onChange={(on) => upd('Shrink to fit', (x) => ({ ...x, fit: on ? 'shrink' : 'none' }))} label="Shrink to fit" />
      </Row>
      <Row label="Limits">
        <NumberField value={l.minSize ?? 0} min={0} label="Smallest size" unit="px" onChange={(minSize) => upd('Smallest size', (x) => ({ ...x, minSize }))} />
        <NumberField
          value={l.maxLines ?? 0}
          min={0}
          label="Most lines (0: any)"
          onChange={(maxLines) => upd('Most lines', (x) => ({ ...x, maxLines: Math.round(maxLines) }))}
        />
      </Row>
      <Row label="Ticker">
        <Select
          label="Ticker"
          value={l.scroll?.mode ?? 'none'}
          options={[
            ['none', 'Still'],
            ['crawl', 'Crawl (moves left)'],
            ['roll', 'Roll (moves up)'],
          ]}
          onChange={(m) =>
            upd('Ticker', (x) => ({
              ...x,
              scroll: m === 'none' ? null : { mode: m, speed: x.scroll?.speed ?? 120, gap: x.scroll?.gap ?? 120 },
              wrap: m === 'crawl' ? false : x.wrap,
            }))
          }
        />
        {l.scroll && (
          <NumberField
            value={l.scroll.speed}
            min={1}
            label="Ticker speed"
            unit="px/s"
            onChange={(speed) => upd('Ticker speed', (x) => ({ ...x, scroll: x.scroll ? { ...x.scroll, speed } : null }))}
          />
        )}
      </Row>
    </Section>
  );
}

/** The shared text style a layer is linked to: choose, make, update, reset, detach. */
function TextStyleRow({ store, l }: { store: Store; l: TextLayer }) {
  const project = useStore(store, (s) => s.project);
  const styles = project.textStyles ?? [];
  const differs = differsFromStyle(project, l);
  const def = styles.find((d) => d.id === l.styleRef);
  return (
    <div className="tt-textstyle">
      <Row label="Text style" hint="Shared text styles: change a style and every text linked to it follows, in every composition.">
        <select
          className="tt-select"
          aria-label="Text style"
          value={def?.id ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '+') {
              const name = prompt('Name of the new text style', l.name);
              if (name !== null) store.edit('New text style', (p) => newTextStyle(p, l.id, name).project);
              return;
            }
            store.edit(v ? 'Apply text style' : 'Detach text style', (p) => applyTextStyle(p, [l.id], v || null));
          }}
        >
          <option value="">None</option>
          {styles.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          <option value="+">New style from this text…</option>
        </select>
      </Row>
      {def && differs && (
        <div className="tt-textstyle-differs" role="status">
          <span className="tt-dim">Changed from “{def.name}”</span>
          <button
            className="tt-link"
            onClick={() => store.edit('Update text style', (p) => styleFromLayer(p, l))}
            title="Every text linked to this style takes this look"
          >
            Update style
          </button>
          <button className="tt-link" onClick={() => store.edit('Reset to text style', (p) => applyTextStyle(p, [l.id], def.id))}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

const ANIMATOR_PRESETS: { name: string; by: TextAnimator['by']; make: (a: TextAnimator) => TextAnimator }[] = [
  { name: 'Letters fade in', by: 'char', make: (a) => ({ ...a, opacity: { v: 0 } }) },
  { name: 'Words rise in', by: 'word', make: (a) => ({ ...a, opacity: { v: 0 }, position: { v: [0, 24] } }) },
  { name: 'Lines one by one', by: 'line', make: (a) => ({ ...a, opacity: { v: 0 }, position: { v: [0, 18] } }) },
  { name: 'Type on', by: 'char', make: (a) => ({ ...a, opacity: { v: 0 }, shape: 'square' }) },
  { name: 'Letters scale in', by: 'char', make: (a) => ({ ...a, opacity: { v: 0 }, scale: { v: 40 } }) },
  { name: 'Words unblur', by: 'word', make: (a) => ({ ...a, opacity: { v: 0 }, blur: { v: 12 } }) },
];

function AnimatorSection({ store, l, compId }: Common & { l: TextLayer }) {
  const c = compOf(store.get().project, compId);
  const upd = (label: string, fn: (x: TextLayer) => TextLayer) =>
    store.edit(label, (p) => updateLayers(p, compId, [l.id], (x) => (x.type === 'text' ? fn(x) : x)));
  const list = l.animators ?? [];
  const add = (i: number) => {
    const pre = ANIMATOR_PRESETS[i]!;
    const inEnd = c.markers.inEnd;
    const base: TextAnimator = { id: uid('a'), name: pre.name, by: pre.by, start: { v: 0 }, end: { v: 100 }, offset: { v: 0 }, shape: 'square' };
    // The range sweeps across during the IN.
    const a = pre.make({
      ...base,
      start: {
        k: [
          { t: Math.max(0, inEnd - 0.8), v: 0, o: [0, 0] },
          { t: inEnd, v: 100, i: [0.58, 1] },
        ],
      },
    });
    upd('Add text animator', (x) => ({ ...x, animators: [...(x.animators ?? []), a] }));
    store.set((s) => ({ open: { ...s.open, [l.id]: 'animated' } }));
  };
  return (
    <Section title="Text animators" open={list.length > 0}>
      <div className="tt-dim tt-small">Letters, words or lines change one after another. Animate the range&rsquo;s start, end or offset in the timeline.</div>
      {list.map((a, i) => (
        <div key={a.id} className="tt-subcard">
          <Row label="Name">
            <input
              className="tt-input"
              value={a.name}
              aria-label="Animator name"
              onChange={(e) => upd('Rename animator', (x) => ({ ...x, animators: x.animators!.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))}
            />
            <button
              className="tt-ico"
              aria-label="Remove animator"
              onClick={() => upd('Remove animator', (x) => ({ ...x, animators: x.animators!.filter((_, j) => j !== i) }))}
            >
              <Trash2 size={13} />
            </button>
          </Row>
          <Row label="By">
            <Select
              label="Animate by"
              value={a.by}
              options={[
                ['char', 'Letter'],
                ['word', 'Word'],
                ['line', 'Line'],
              ]}
              onChange={(by) => upd('Animator', (x) => ({ ...x, animators: x.animators!.map((y, j) => (j === i ? { ...y, by } : y)) }))}
            />
            <Select
              label="Range shape"
              value={a.shape}
              options={[
                ['square', 'Square'],
                ['rampUp', 'Ramp up'],
                ['rampDown', 'Ramp down'],
                ['triangle', 'Triangle'],
                ['smooth', 'Smooth'],
              ]}
              onChange={(shape) => upd('Animator', (x) => ({ ...x, animators: x.animators!.map((y, j) => (j === i ? { ...y, shape } : y)) }))}
            />
            <Toggle
              value={!!a.reverse}
              onChange={(reverse) => upd('Animator', (x) => ({ ...x, animators: x.animators!.map((y, j) => (j === i ? { ...y, reverse } : y)) }))}
              label="Last first"
            />
          </Row>
          {(['opacity', 'scale', 'rotation', 'blur'] as const).map((k) =>
            a[k] ? (
              <Row key={k} label={k[0]!.toUpperCase() + k.slice(1)}>
                <NumberField
                  value={valueAt(a[k] as never, 0, 0 as never) as number}
                  label={`Animator ${k}`}
                  onChange={(v) => upd('Animator', (x) => ({ ...x, animators: x.animators!.map((y, j) => (j === i ? { ...y, [k]: { v } } : y)) }))}
                />
              </Row>
            ) : null,
          )}
          {a.position && (
            <Row label="Offset">
              <NumberField
                value={vec(a.position, 0, [0, 0])[0]}
                label="Animator x"
                unit="px"
                onChange={(v) =>
                  upd('Animator', (x) => ({
                    ...x,
                    animators: x.animators!.map((y, j) => (j === i ? { ...y, position: { v: [v, vec(y.position, 0, [0, 0])[1]] } } : y)),
                  }))
                }
              />
              <NumberField
                value={vec(a.position, 0, [0, 0])[1]}
                label="Animator y"
                unit="px"
                onChange={(v) =>
                  upd('Animator', (x) => ({
                    ...x,
                    animators: x.animators!.map((y, j) => (j === i ? { ...y, position: { v: [vec(y.position, 0, [0, 0])[0], v] } } : y)),
                  }))
                }
              />
            </Row>
          )}
          <div className="tt-chips">
            {(['opacity', 'position', 'scale', 'rotation', 'blur'] as const)
              .filter((k) => !a[k])
              .map((k) => (
                <button
                  key={k}
                  className="tt-chip"
                  onClick={() =>
                    upd('Animator', (x) => ({
                      ...x,
                      animators: x.animators!.map((y, j) =>
                        j === i ? { ...y, [k]: k === 'position' ? { v: [0, 20] } : k === 'scale' ? { v: 50 } : { v: 0 } } : y,
                      ),
                    }))
                  }
                >
                  + {k}
                </button>
              ))}
          </div>
        </div>
      ))}
      <div className="tt-chips">
        {ANIMATOR_PRESETS.map((p, i) => (
          <button key={p.name} className="tt-chip" onClick={() => add(i)}>
            <Plus size={11} /> {p.name}
          </button>
        ))}
      </div>
    </Section>
  );
}

function ShapeSection({
  store,
  l,
  compId,
  fieldKeys,
  tokens,
  vals,
  prop,
  texts,
}: Common & {
  l: ShapeLayer;
  fieldKeys: string[];
  tokens: ReturnType<typeof tokensFor>;
  vals: Record<string, string>;
  time: number;
  prop: (path: string, label: string, fallback: Value, unit?: string, opt?: { min?: number; max?: number }) => ReactElement;
  texts: TextLayer[];
}) {
  const upd = (label: string, fn: (x: ShapeLayer) => ShapeLayer) =>
    store.edit(label, (p) => updateLayers(p, compId, [l.id], (x) => (x.type === 'shape' ? fn(x) : x)));
  const stroke: Stroke = l.stroke ?? { paint: { type: 'solid', color: '$accent' }, width: 4 };
  return (
    <Section title="Shape">
      <Row label="Kind">
        <Select
          label="Shape kind"
          value={l.shape}
          options={[
            ['rect', 'Rectangle'],
            ['ellipse', 'Ellipse'],
            ['path', 'Path'],
          ]}
          onChange={(shape) =>
            upd('Shape kind', (x) => {
              const sz = vec(x.size, 0, [100, 100]);
              return shape === 'path' && !x.path
                ? { ...x, shape, path: x.shape === 'ellipse' ? ellipsePath(sz[0], sz[1]) : rectPath(sz[0], sz[1], 0) }
                : { ...x, shape };
            })
          }
        />
      </Row>
      {l.shape !== 'path' && prop('size', 'Size', [100, 100], 'px', { min: 0 })}
      {l.shape === 'rect' && !l.corners && prop('roundness', 'Corners', 0, 'px', { min: 0 })}
      {l.shape === 'rect' && (
        <Row label={l.corners ? 'Corners' : ''} hint="Each corner its own radius: top left, top right, bottom right, bottom left">
          <Toggle
            value={!!l.corners}
            onChange={(on) =>
              upd('Each corner', (x) => {
                const r = num(x.roundness, store.get().time, 0);
                return { ...x, corners: on ? [r, r, r, r] : null, roundness: on ? x.roundness : { v: x.corners?.[0] ?? r } };
              })
            }
            label="Each corner"
          />
          {l.corners &&
            (['Top left', 'Top right', 'Bottom right', 'Bottom left'] as const).map((name, i) => (
              <NumberField
                key={name}
                value={l.corners![i]!}
                min={0}
                label={`${name} corner`}
                unit="px"
                onChange={(v) =>
                  upd('Corner', (x) => ({ ...x, corners: x.corners ? (x.corners.map((c, j) => (j === i ? v : c)) as [number, number, number, number]) : null }))
                }
              />
            ))}
        </Row>
      )}
      {l.shape === 'path' && (
        <div className="tt-dim tt-small">
          Drawn with the pen: {l.path?.v.length ?? 0} points, {l.path?.closed ? 'closed' : 'open'}.
        </div>
      )}
      <Row label="Fill">
        <Toggle value={!!l.fill} onChange={(on) => upd('Fill', (x) => ({ ...x, fill: on ? { type: 'solid', color: '$box' } : null }))} label="On" />
      </Row>
      {l.fill && (
        <PaintField
          paint={l.fill}
          label="Fill color"
          onChange={(fill) => upd('Fill', (x) => ({ ...x, fill }))}
          tokens={tokens}
          vals={vals}
          fieldKeys={fieldKeys}
        />
      )}
      <Row label="Stroke">
        <Toggle value={!!l.stroke} onChange={(on) => upd('Stroke', (x) => ({ ...x, stroke: on ? stroke : null }))} label="On" />
        {l.stroke && (
          <NumberField
            value={l.stroke.width}
            min={0}
            label="Stroke width"
            unit="px"
            onChange={(width) => upd('Stroke width', (x) => ({ ...x, stroke: { ...stroke, ...x.stroke, width } }))}
          />
        )}
      </Row>
      {l.stroke && (
        <>
          <PaintField
            paint={l.stroke.paint}
            label="Stroke color"
            onChange={(paint) => upd('Stroke color', (x) => ({ ...x, stroke: { ...stroke, ...x.stroke, paint } }))}
            tokens={tokens}
            vals={vals}
            fieldKeys={fieldKeys}
          />
          <Row label="Place" hint="Where the line sits on the outline">
            <Select
              label="Stroke place"
              value={l.stroke.align ?? 'center'}
              options={[
                ['center', 'Centered'],
                ['inside', 'Inside'],
                ['outside', 'Outside'],
              ]}
              onChange={(align) => upd('Stroke place', (x) => ({ ...x, stroke: { ...stroke, ...x.stroke, align: align === 'center' ? undefined : align } }))}
            />
            <Select
              label="Corners of the line"
              value={l.stroke.join ?? 'miter'}
              options={[
                ['miter', 'Sharp'],
                ['round', 'Round'],
                ['bevel', 'Bevel'],
              ]}
              onChange={(join) => upd('Line corners', (x) => ({ ...x, stroke: { ...stroke, ...x.stroke, join } }))}
            />
          </Row>
          <Row label="Ends">
            <Select
              label="Line ends"
              value={l.stroke.cap ?? 'butt'}
              options={[
                ['butt', 'Flat'],
                ['round', 'Round'],
                ['square', 'Square'],
              ]}
              onChange={(cap) => upd('Line ends', (x) => ({ ...x, stroke: { ...stroke, ...x.stroke, cap } }))}
            />
            <Toggle
              value={!!l.stroke.dash?.length}
              onChange={(on) => upd('Dashes', (x) => ({ ...x, stroke: { ...stroke, ...x.stroke, dash: on ? [12, 8] : undefined } }))}
              label="Dashed"
            />
          </Row>
          {!!l.stroke.dash?.length && (
            <Row label="Dashes">
              <NumberField
                value={l.stroke.dash[0] ?? 12}
                min={0}
                label="Dash length"
                unit="px"
                onChange={(d) => upd('Dashes', (x) => ({ ...x, stroke: { ...stroke, ...x.stroke, dash: [d, x.stroke?.dash?.[1] ?? 8] } }))}
              />
              <NumberField
                value={l.stroke.dash[1] ?? 8}
                min={0}
                label="Gap length"
                unit="px"
                onChange={(g) => upd('Dashes', (x) => ({ ...x, stroke: { ...stroke, ...x.stroke, dash: [x.stroke?.dash?.[0] ?? 12, g] } }))}
              />
            </Row>
          )}
          {(l.extraStrokes ?? []).map((ex, i) => (
            <div key={i} className="tt-subcard">
              <Row label={`Outline ${i + 2}`}>
                <NumberField
                  value={ex.width}
                  min={0}
                  label={`Outline ${i + 2} width`}
                  unit="px"
                  onChange={(width) => upd('Outline', (x) => ({ ...x, extraStrokes: (x.extraStrokes ?? []).map((y, j) => (j === i ? { ...y, width } : y)) }))}
                />
                <Select
                  label={`Outline ${i + 2} place`}
                  value={ex.align ?? 'center'}
                  options={[
                    ['center', 'Centered'],
                    ['inside', 'Inside'],
                    ['outside', 'Outside'],
                  ]}
                  onChange={(align) => upd('Outline', (x) => ({ ...x, extraStrokes: (x.extraStrokes ?? []).map((y, j) => (j === i ? { ...y, align } : y)) }))}
                />
                <button
                  className="tt-ico"
                  aria-label={`Remove outline ${i + 2}`}
                  onClick={() => upd('Remove outline', (x) => ({ ...x, extraStrokes: (x.extraStrokes ?? []).filter((_, j) => j !== i) }))}
                >
                  <Trash2 size={13} />
                </button>
              </Row>
              <PaintField
                paint={ex.paint}
                label={`Outline ${i + 2} color`}
                onChange={(paint) => upd('Outline', (x) => ({ ...x, extraStrokes: (x.extraStrokes ?? []).map((y, j) => (j === i ? { ...y, paint } : y)) }))}
                tokens={tokens}
                vals={vals}
                fieldKeys={fieldKeys}
              />
            </div>
          ))}
          <Row label="">
            <button
              className="tt-link"
              onClick={() =>
                upd('Add outline', (x) => ({
                  ...x,
                  extraStrokes: [...(x.extraStrokes ?? []), { paint: { type: 'solid', color: '$text' }, width: 2, align: 'outside' }],
                }))
              }
              title="Another outline over the first (a double outline)"
            >
              + Another outline
            </button>
          </Row>
          <Row label="Trim">
            <Toggle
              value={!!l.trim}
              onChange={(on) => upd('Trim path', (x) => ({ ...x, trim: on ? { start: { v: 0 }, end: { v: 100 }, offset: { v: 0 } } : null }))}
              label="Draw part of the outline"
            />
          </Row>
          {l.trim && (
            <>
              {prop('trim.start', 'Trim start', 0, '%')}
              {prop('trim.end', 'Trim end', 100, '%')}
              {prop('trim.offset', 'Trim offset', 0, '%')}
            </>
          )}
        </>
      )}
      {l.shape !== 'path' && (
        <>
          <Row label="Follow text" hint="The box grows and shrinks with the words of a text layer">
            <select
              className="tt-select"
              aria-label="Follow text layer"
              value={l.fitTo?.layer ?? ''}
              onChange={(e) =>
                upd('Follow text', (x) => ({
                  ...x,
                  fitTo: e.target.value
                    ? { layer: e.target.value, pad: x.fitTo?.pad ?? [24, 12], min: x.fitTo?.min ?? [0, 0], axis: x.fitTo?.axis ?? 'x' }
                    : null,
                }))
              }
            >
              <option value="">No</option>
              {texts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Row>
          {l.fitTo && (
            <Row label="Padding">
              <NumberField
                value={l.fitTo.pad[0]}
                label="Padding sides"
                unit="px"
                onChange={(v) => upd('Padding', (x) => ({ ...x, fitTo: x.fitTo ? { ...x.fitTo, pad: [v, x.fitTo.pad[1]] } : null }))}
              />
              <NumberField
                value={l.fitTo.min?.[0] ?? 0}
                label="Smallest width"
                unit="px"
                onChange={(v) => upd('Smallest width', (x) => ({ ...x, fitTo: x.fitTo ? { ...x.fitTo, min: [v, x.fitTo.min?.[1] ?? 0] } : null }))}
              />
              <Toggle
                value={l.fitTo.axis === 'both'}
                onChange={(b) => upd('Follow height', (x) => ({ ...x, fitTo: x.fitTo ? { ...x.fitTo, axis: b ? 'both' : 'x' } : null }))}
                label="Height too"
              />
            </Row>
          )}
        </>
      )}
    </Section>
  );
}

/** One-click moves for the IN and the OUT, timed to the markers. */
function MotionPresets({ store, l, compId }: Common & { l: Layer }) {
  const c = compOf(store.get().project, compId);
  const { inEnd, outStart } = c.markers;
  const inAt = Math.max(0, inEnd - 0.6);
  const outLen = Math.min(0.5, Math.max(0.2, c.duration - outStart));
  const apply = (label: string, fn: (x: Layer) => Layer) =>
    store.edit(label, (p) => updateLayers(p, compId, [l.id], (x) => fn(JSON.parse(JSON.stringify(x)) as Layer)));
  const IN: [string, (x: Layer) => Layer][] = [
    ['Fade', (x) => fade(x, { at: inAt, dur: 0.5 })],
    ['Slide from left', (x) => fade(slide(x, [-40, 0], { at: inAt, dur: 0.55 }), { at: inAt, dur: 0.4 })],
    ['Slide up', (x) => fade(slide(x, [0, 30], { at: inAt, dur: 0.55 }), { at: inAt, dur: 0.4 })],
    ['Wipe from left', (x) => wipe(x, 'left', { at: inAt, dur: 0.5 })],
    ['Wipe from bottom', (x) => wipe(x, 'bottom', { at: inAt, dur: 0.5 })],
    ['Grow', (x) => grow(x, { at: inAt, dur: 0.5 })],
  ];
  if (l.type === 'text') {
    IN.push(['Letters', (x) => reveal(x as TextLayer, 'char', { at: inAt, dur: 0.6 }, 16)]);
    IN.push(['Words', (x) => reveal(x as TextLayer, 'word', { at: inAt, dur: 0.6 }, 16)]);
    IN.push(['Lines', (x) => reveal(x as TextLayer, 'line', { at: inAt, dur: 0.6 }, 16)]);
  }
  const OUT: [string, (x: Layer) => Layer][] = [
    ['Fade', (x) => fade(x, { at: outStart, dur: outLen }, true)],
    ['Slide left', (x) => fade(slide(x, [-40, 0], { at: outStart, dur: outLen }, true), { at: outStart, dur: outLen }, true)],
    ['Slide down', (x) => fade(slide(x, [0, 30], { at: outStart, dur: outLen }, true), { at: outStart, dur: outLen }, true)],
    ['Wipe to left', (x) => wipe(x, 'right', { at: outStart, dur: outLen }, true)],
    ['Shrink', (x) => grow(x, { at: outStart, dur: outLen }, true)],
  ];
  const [saved, setSaved] = useState(loadAnimPresets);
  const [step, setStep] = useState(3);
  const [bars, setBars] = useState(false);
  const selection = store.get().selection;
  return (
    <Section title="Animate" open={false}>
      <div className="tt-dim tt-small">Adds keyframes timed to the IN and OUT markers.</div>
      {selection.length > 1 && (
        <Row label="Stagger" hint="Each layer's animation a few frames after the one above it">
          <NumberField value={step} min={0} step={1} label="Stagger frames" unit="fr" onChange={(v) => setStep(Math.round(v))} />
          <Toggle value={bars} onChange={setBars} label="Bars too" />
          <button
            className="tt-btn"
            onClick={() =>
              store.edit(`Stagger ${selection.length} layers`, (p) => stagger(p, compId, inStackOrder(p, compId, selection), step / c.fps, bars))
            }
          >
            Stagger
          </button>
        </Row>
      )}
      <div className="tt-presets">
        <span>Saved</span>
        {saved.map((a) => (
          <span key={a.id} className="tt-chip tt-chip-split">
            <button
              onClick={() =>
                store.edit(`Apply “${a.name}”`, (p) => pasteKeys(p, compId, selection.length ? selection : [l.id], a.clip, store.get().time))
              }
              title="Put this animation on the selected layers, from the playhead"
            >
              {a.name}
            </button>
            <button aria-label={`Remove ${a.name}`} title="Remove this saved animation" onClick={() => setSaved(removeAnimPreset(a.id))}>
              ×
            </button>
          </span>
        ))}
        <button
          className="tt-chip"
          onClick={() => {
            const name = prompt('Name for this animation', `${l.name} animation`);
            if (name === null) return;
            if (saveAnimPreset(l, name)) setSaved(loadAnimPresets());
            else store.set({ status: 'This layer has no keyframes to save.' });
          }}
          title="Keep this layer's keyframes as an animation to give other layers"
        >
          <Plus size={11} /> Save this animation
        </button>
      </div>
      <div className="tt-presets">
        <span>IN</span>
        {IN.map(([n, f]) => (
          <button key={n} className="tt-chip" onClick={() => apply(`Animate in: ${n}`, f)}>
            {n}
          </button>
        ))}
      </div>
      <div className="tt-presets">
        <span>OUT</span>
        {OUT.map(([n, f]) => (
          <button key={n} className="tt-chip" onClick={() => apply(`Animate out: ${n}`, f)}>
            {n}
          </button>
        ))}
      </div>
    </Section>
  );
}

function MaskSection({ store, l, compId, time }: Common & { l: Layer; time: number }) {
  const upd = (label: string, fn: (x: Layer) => Layer) => store.edit(label, (p) => updateLayers(p, compId, [l.id], fn));
  const masks = l.masks ?? [];
  const add = (kind: 'rect' | 'ellipse') => {
    const b = layerBox(lookOf(store.get()), l);
    const w = Math.max(10, b.w || 400);
    const h = Math.max(10, b.h || 200);
    const base = kind === 'rect' ? rectPath(w * 0.6, h * 0.6, 0) : ellipsePath(w * 0.6, h * 0.6);
    const path = { ...base, v: base.v.map((v) => ({ ...v, p: [v.p[0] + b.x + w * 0.2, v.p[1] + b.y + h * 0.2] as Vec2 })) };
    const m: Mask = { id: uid('m'), name: `Mask ${masks.length + 1}`, path, mode: 'add', feather: { v: 0 } };
    upd('Add mask', (x) => ({ ...x, masks: [...(x.masks ?? []), m] }));
  };
  void time;
  return (
    <Section title="Masks" open={masks.length > 0}>
      {masks.map((m, i) => (
        <div key={m.id} className="tt-subcard">
          <Row label={m.name}>
            <Select
              label="Mask mode"
              value={m.mode}
              options={[
                ['add', 'Add'],
                ['subtract', 'Subtract'],
                ['intersect', 'Intersect'],
              ]}
              onChange={(mode) => upd('Mask mode', (x) => ({ ...x, masks: x.masks!.map((y, j) => (j === i ? { ...y, mode } : y)) }))}
            />
            <Toggle
              value={!!m.inverted}
              onChange={(inverted) => upd('Invert mask', (x) => ({ ...x, masks: x.masks!.map((y, j) => (j === i ? { ...y, inverted } : y)) }))}
              label="Invert"
            />
            <button
              className="tt-ico"
              aria-label="Remove mask"
              onClick={() => upd('Remove mask', (x) => ({ ...x, masks: x.masks!.filter((_, j) => j !== i) }))}
            >
              <Trash2 size={13} />
            </button>
          </Row>
          <Row label="Feather">
            <NumberField
              value={valueAt(m.feather as never, 0, 0 as never) as number}
              min={0}
              label="Mask feather"
              unit="px"
              onChange={(v) => upd('Mask feather', (x) => ({ ...x, masks: x.masks!.map((y, j) => (j === i ? { ...y, feather: { v } } : y)) }))}
            />
          </Row>
        </div>
      ))}
      <div className="tt-chips">
        <button className="tt-chip" onClick={() => add('rect')}>
          <Plus size={11} /> Rectangle mask
        </button>
        <button className="tt-chip" onClick={() => add('ellipse')}>
          <Plus size={11} /> Ellipse mask
        </button>
      </div>
    </Section>
  );
}

function EffectSection({
  store,
  l,
  compId,
  tokens,
  vals,
  fieldKeys,
}: Common & { l: Layer; tokens: ReturnType<typeof tokensFor>; vals: Record<string, string>; fieldKeys: string[] }) {
  const upd = (label: string, fn: (x: Layer) => Layer) => store.edit(label, (p) => updateLayers(p, compId, [l.id], fn));
  const list = l.effects ?? [];
  const add = (type: Effect['type']) => {
    const id = uid('e');
    const e: Effect =
      type === 'dropShadow'
        ? { id, type, on: true, color: '#000000', opacity: { v: 50 }, angle: 90, distance: { v: 4 }, softness: { v: 8 } }
        : type === 'glow'
          ? { id, type, on: true, color: '$accent', opacity: { v: 40 }, radius: { v: 10 } }
          : type === 'blur'
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
                    : { id, type, on: true, color: '$accent' };
    upd(`Add ${EFFECT_NAMES[type]!.toLowerCase()}`, (x) => ({ ...x, effects: [...(x.effects ?? []), e] }));
  };
  const set = (i: number, patch: Partial<Effect>) =>
    upd('Change effect', (x) => ({ ...x, effects: x.effects!.map((y, j) => (j === i ? ({ ...y, ...patch } as Effect) : y)) }));
  return (
    <Section title="Effects" open={list.length > 0}>
      {list.map((e, i) => (
        <div key={e.id} className="tt-subcard">
          <Row label={EFFECT_NAMES[e.type]!}>
            <Toggle value={e.on} onChange={(on) => set(i, { on })} label="On" />
            <button
              className="tt-ico"
              aria-label="Remove effect"
              onClick={() => upd('Remove effect', (x) => ({ ...x, effects: x.effects!.filter((_, j) => j !== i) }))}
            >
              <Trash2 size={13} />
            </button>
          </Row>
          {'color' in e && (
            <Row label="Color">
              <ColorField
                value={e.color}
                onChange={(color) => set(i, { color } as Partial<Effect>)}
                tokens={tokens}
                values={vals}
                label="Effect"
                fields={fieldKeys}
              />
            </Row>
          )}
          {e.type === 'dropShadow' && (
            <Row label="Shadow">
              <NumberField value={e.angle} label="Shadow angle" unit="°" onChange={(angle) => set(i, { angle } as Partial<Effect>)} />
              <NumberField
                value={valueAt(e.distance as never, 0, 0 as never) as number}
                label="Shadow distance"
                unit="px"
                onChange={(v) => set(i, { distance: { v } } as Partial<Effect>)}
              />
              <NumberField
                value={valueAt(e.softness as never, 0, 0 as never) as number}
                min={0}
                label="Shadow softness"
                unit="px"
                onChange={(v) => set(i, { softness: { v } } as Partial<Effect>)}
              />
            </Row>
          )}
          {e.type === 'glow' && (
            <Row label="Glow">
              <NumberField
                value={valueAt(e.radius as never, 0, 0 as never) as number}
                min={0}
                label="Glow size"
                unit="px"
                onChange={(v) => set(i, { radius: { v } } as Partial<Effect>)}
              />
            </Row>
          )}
          {(e.type === 'dropShadow' || e.type === 'glow') && (
            <Row label="Opacity">
              <NumberField
                value={valueAt(e.opacity as never, 0, 0 as never) as number}
                min={0}
                max={100}
                label="Effect opacity"
                unit="%"
                onChange={(v) => set(i, { opacity: { v } } as Partial<Effect>)}
              />
            </Row>
          )}
          {e.type === 'stroke' && (
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
            <Row label="Amount">
              <NumberField
                value={valueAt(e.amount as never, 0, 0 as never) as number}
                min={0}
                label="Blur amount"
                unit="px"
                onChange={(v) => set(i, { amount: { v } } as Partial<Effect>)}
              />
            </Row>
          )}
        </div>
      ))}
      <div className="tt-dim tt-small">Effects are optional. Plain, high-contrast graphics read best on air.</div>
      <div className="tt-chips">
        {(['dropShadow', 'glow', 'stroke', 'blur', 'fill', 'gradient', 'color', 'noise'] as const).map((t) => (
          <button key={t} className="tt-chip" onClick={() => add(t)}>
            <Plus size={11} /> {EFFECT_NAMES[t]}
          </button>
        ))}
      </div>
    </Section>
  );
}

/** Layer styles: save how a layer looks and give it to others. */
function StyleSection({ store, l, compId }: Common & { l: Layer }) {
  const [list, setList] = useState(loadStyles);
  const [name, setName] = useState('');
  const selection = store.get().selection;
  return (
    <Section title="Layer styles" open={false}>
      <div className="tt-dim tt-small">A style keeps colors, fonts, outline, corners and effects. Apply it to other layers of the same kind.</div>
      {list
        .filter((s) => s.kind === l.type)
        .map((s) => (
          <div key={s.id} className="tt-style-row">
            <button className="tt-chip" onClick={() => store.edit(`Apply style ${s.name}`, (p) => updateLayers(p, compId, selection, (x) => applyStyle(x, s)))}>
              {s.name}
            </button>
            <button className="tt-ico" aria-label={`Remove style ${s.name}`} onClick={() => setList(removeStyle(s.id))}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      <Row label="Save as">
        <input className="tt-input" value={name} placeholder="Style name" onChange={(e) => setName(e.target.value)} aria-label="Style name" />
        <button
          className="tt-btn"
          disabled={!name.trim() || !styleOf(l)}
          onClick={() => {
            const s = styleOf(l);
            if (!s) return;
            setList(saveStyle({ ...s, name: name.trim() }));
            setName('');
          }}
        >
          Save
        </button>
      </Row>
    </Section>
  );
}

export { flatLayers };
