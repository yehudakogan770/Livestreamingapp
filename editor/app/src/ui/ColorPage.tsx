import { Activity, ChevronLeft, ChevronRight, ClipboardPaste, Copy, Layers, Palette, Plus, RotateCcw, Split, Trash2, Workflow } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { valueAt, setValue } from '../model/anim';
import {
  addBeside,
  addSerial,
  allNodes,
  BASIC_PARAMS,
  changeGrade,
  cloneGrade,
  DEFAULT_QUALIFIER,
  DEFAULT_WINDOW,
  findNode,
  flatCurves,
  gradeEffect,
  HSL_PARAMS,
  looseColorEffects,
  moveStep,
  newNode,
  NODE_PARAMS,
  nodeNumber,
  nudgeNode,
  removeNode,
  resetNode,
  setMix,
  shownGrade,
  updateNode,
  WHEEL_PARAMS,
  type Grade,
  type GradeNode,
  type GradeWindow,
  type MixKind,
  type NodeParam,
  type Qualifier,
} from '../model/grade';
import { current, end } from '../model/seq';
import type { Clip, Param } from '../model/types';
import { selectedIds, useDoc, type Doc } from '../doc';
import type { Engine } from '../player/engine';
import { curveTable, type CurvePoints, type CurveSet } from '../render/color';
import type { Actions } from './actions';
import { Choice, ParamRow, Scrub, Section } from './controls';
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

/** What Copy grade took (pasted onto other clips with Paste grade). */
let copiedGrade: Grade | null = null;

/** The node chosen on the Color page: the one in the Ui state if the grade has it, otherwise the first. */
function chosenNode(g: Grade, id: string | null): GradeNode | undefined {
  return findNode(g, id) ?? allNodes(g)[0];
}

const COLOR_TYPES = ['grade', 'basic', 'wheels', 'curves', 'hsl', 'lut', 'vignette'];

export function ColorPanel({ doc, engine, actions, ui }: { doc: Doc; engine: Engine; actions: Actions; ui: Ui }) {
  useDoc(doc);
  const u = useUi(ui);
  const t = usePlayhead(engine);
  const [, setCopied] = useState(0);
  const clip = gradedClip(doc, t);
  const grade = clip ? shownGrade(clip) : null;
  const node = grade ? chosenNode(grade, u.gradeNode) : undefined;
  const matte = u.showMatte && clip && node ? `${clip.id}|${node.id}` : '';
  // The viewer shows the chosen node's matte while "Show matte" is on (and the Color page is open).
  useEffect(() => {
    const [c, n] = matte.split('|');
    engine.setMatte(c && n ? { clip: c, node: n } : null);
  }, [engine, matte]);
  useEffect(() => () => engine.setMatte(null), [engine]);
  if (!clip || !grade || !node) return <div className="colorp colorp--empty">Put the playhead over a clip (or select one) to change its color.</div>;
  const local = Math.max(0, Math.min(clip.length - 1, t - clip.start));
  const index = allNodes(grade).findIndex((n) => n.id === node.id);

  /** Change the clip's grade; `f` gets the grade and the chosen node's id. Every change can be undone. */
  const change = (label: string, f: (g: Grade, id: string) => Grade, key?: string) => {
    let picked = node.id;
    actions.update(
      [clip.id],
      label,
      (c) =>
        changeGrade(c, (g) => {
          // Before the first change the page showed stand-in ids: the same node by its place.
          picked = (findNode(g, node.id) ?? allNodes(g)[index] ?? allNodes(g)[0])?.id ?? node.id;
          return f(g, picked);
        }),
      key,
    );
    if (picked !== u.gradeNode) ui.set({ gradeNode: picked });
  };
  /** Change a node that may not be the chosen one (found by its place before the first change). */
  const changeById = (id: string, label: string, f: (n: GradeNode) => GradeNode) => {
    const at = allNodes(grade).findIndex((n) => n.id === id);
    change(label, (g) => {
      const target = findNode(g, id) ?? allNodes(g)[at];
      return target ? updateNode(g, target.id, f) : g;
    });
  };
  const changeNode = (label: string, f: (n: GradeNode) => GradeNode, key?: string) => change(label, (g, id) => updateNode(g, id, f), key);
  const setParam = (k: string, p: Param, final: boolean) =>
    changeNode('Color', (n) => ({ ...n, p: { ...n.p, [k]: p } }), final ? undefined : `grade-${clip.id}-${k}`);
  const resetKeys = (label: string, keys: string[]) =>
    changeNode(label, (n) => ({ ...n, p: Object.fromEntries(Object.entries(n.p).filter(([k]) => !keys.includes(k))) }));
  const seek = (f: number) => {
    engine.pause();
    engine.seek(f);
  };
  const row = (x: NodeParam, label = x.label) => (
    <ParamRow
      key={x.key}
      label={label}
      param={node.p[x.key]}
      local={local}
      def={x.def}
      min={x.min}
      max={x.max}
      step={x.step}
      unit={x.unit}
      clipStart={clip.start}
      onSeek={seek}
      onChange={(p, final) => setParam(x.key, p, final)}
    />
  );
  const addNode = (label: string, f: (g: Grade, id: string, n: GradeNode) => Grade) => {
    const fresh = newNode();
    change(label, (g, id) => f(g, id, fresh));
    ui.set({ gradeNode: fresh.id });
  };
  const videoClips = () => {
    const s = current(doc.project);
    const ids = selectedIds(doc.state.selection);
    return s.clips.filter((c) => ids.includes(c.id) && s.tracks.find((tr) => tr.id === c.track)?.kind === 'video').map((c) => c.id);
  };
  const pasteGrade = () => {
    const board = copiedGrade;
    if (!board) return;
    const ids = videoClips();
    actions.update(ids.length ? ids : [clip.id], 'Paste grade', (c) => changeGrade(c, () => cloneGrade(board)));
  };
  const loose = gradeEffect(clip) ? looseColorEffects(clip).length : 0;
  const tag = `${nodeNumber(grade, node.id)}${node.label ? ` ${node.label}` : ''}`;
  return (
    <div className="colorp">
      <div className="colorp__nodes">
        <div className="ngraph__bar">
          <span className="ngraph__title">
            <Workflow />
            Nodes
          </span>
          <button
            type="button"
            className="btn btn--sm"
            title="A new node after this one"
            onClick={() => addNode('Add node', (g, id, n) => addSerial(g, id, n))}
          >
            <Plus />
            Serial
          </button>
          <button
            type="button"
            className="btn btn--sm"
            title="A new node beside this one: both start from the same picture and their changes are added up"
            onClick={() => addNode('Add parallel node', (g, id, n) => addBeside(g, id, 'parallel', n))}
          >
            <Split />
            Parallel
          </button>
          <button
            type="button"
            className="btn btn--sm"
            title="A new node layered over this one: where its qualifier or window lets it, it covers the nodes under it"
            onClick={() => addNode('Add layer node', (g, id, n) => addBeside(g, id, 'layer', n))}
          >
            <Layers />
            Layer
          </button>
          <span className="ngraph__gap" />
          <button
            type="button"
            className="tbtn"
            title="Earlier (in a layer mix: lower)"
            aria-label="Move node earlier"
            onClick={() => change('Move node', (g, id) => nudgeNode(g, id, -1))}
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            className="tbtn"
            title="Later (in a layer mix: higher)"
            aria-label="Move node later"
            onClick={() => change('Move node', (g, id) => nudgeNode(g, id, 1))}
          >
            <ChevronRight />
          </button>
          <button type="button" className="btn btn--sm" title="Back to doing nothing" onClick={() => change('Reset node', (g, id) => resetNode(g, id))}>
            <RotateCcw />
            Reset
          </button>
          <button type="button" className="btn btn--sm" title="Take this node out" onClick={() => change('Delete node', (g, id) => removeNode(g, id))}>
            <Trash2 />
            Delete
          </button>
          <span className="ngraph__gap" />
          <button
            type="button"
            className="btn btn--sm"
            title="Copy this clip's whole grade"
            onClick={() => {
              copiedGrade = structuredClone(grade);
              setCopied((x) => x + 1);
              ui.note(`Copied the grade of ${clip.name}`);
            }}
          >
            <Copy />
            Copy grade
          </button>
          <button
            type="button"
            className="btn btn--sm"
            disabled={!copiedGrade}
            title="Put the copied grade on the selected clips (or this one)"
            onClick={pasteGrade}
          >
            <ClipboardPaste />
            Paste grade
          </button>
        </div>
        <NodeGraph
          grade={grade}
          chosen={node.id}
          onChoose={(id) => ui.set({ gradeNode: id })}
          onToggle={(id) => changeById(id, 'Bypass node', (n) => ({ ...n, on: !n.on }))}
          onRename={(id, label) => changeById(id, 'Rename node', (n) => ({ ...n, label }))}
          onMove={(from, to) => change('Move node', (g) => moveStep(g, from, to))}
          onMix={(step, kind) => change('Node mix', (g) => setMix(g, step, kind))}
        />
        {loose > 0 && <p className="insp__note">This clip also has {loose} color effect(s) outside its nodes (in the Inspector).</p>}
      </div>
      <div className="colorp__col colorp__col--wheels">
        <h3>
          <Palette />
          Color wheels{' '}
          <small>
            {clip.name} · node {tag}
          </small>
          <button
            type="button"
            className="sect__btn"
            title="Reset the wheels"
            onClick={() =>
              resetKeys(
                'Reset wheels',
                WHEEL_PARAMS.map((x) => x.key),
              )
            }
          >
            <RotateCcw />
          </button>
        </h3>
        <div className="wheels">
          {(
            [
              ['lift', 'Shadows'],
              ['gamma', 'Midtones'],
              ['gain', 'Highlights'],
              ['offset', 'Offset'],
            ] as const
          ).map(([k, name]) => (
            <Wheel
              key={k}
              name={name}
              x={valueAt(node.p[`${k}X`], local)}
              y={valueAt(node.p[`${k}Y`], local)}
              level={valueAt(node.p[k], local)}
              onPuck={(x, y, final) =>
                changeNode(
                  'Color',
                  (n) => ({ ...n, p: { ...n.p, [`${k}X`]: setValue(n.p[`${k}X`], local, x), [`${k}Y`]: setValue(n.p[`${k}Y`], local, y) } }),
                  final ? undefined : `grade-${clip.id}-${k}`,
                )
              }
              onLevel={(v, final) =>
                changeNode('Color', (n) => ({ ...n, p: { ...n.p, [k]: setValue(n.p[k], local, v) } }), final ? undefined : `grade-${clip.id}-${k}L`)
              }
            />
          ))}
        </div>
      </div>
      <div className="colorp__col">
        <Section
          title="Primaries"
          actions={
            <button
              type="button"
              className="sect__btn"
              title="Reset"
              onClick={() =>
                resetKeys(
                  'Reset primaries',
                  BASIC_PARAMS.map((x) => x.key),
                )
              }
            >
              <RotateCcw />
            </button>
          }
        >
          {BASIC_PARAMS.map((x) => row(x))}
        </Section>
      </div>
      <div className="colorp__col">
        <CurvesEditor
          set={node.curves ?? flatCurves()}
          onChange={(set, final) => changeNode('Curves', (n) => ({ ...n, curves: set }), final ? undefined : `grade-${clip.id}-curves`)}
        />
        {row(NODE_PARAMS.find((x) => x.key === 'curveMix') as NodeParam)}
        <Section title="Change one color" open={HSL_PARAMS.some((x) => node.p[x.key] !== undefined)}>
          {HSL_PARAMS.map((x) => row(x))}
        </Section>
        <QualifierControls
          q={node.qualifier}
          showMatte={u.showMatte}
          onMatte={(v) => ui.set({ showMatte: v })}
          onChange={(q, final) => changeNode('Qualifier', (n) => ({ ...n, qualifier: q }), final ? undefined : `grade-${clip.id}-qual`)}
        />
        <WindowControls
          w={node.window}
          showMatte={u.showMatte}
          onMatte={(v) => ui.set({ showMatte: v })}
          onChange={(w, final) => changeNode('Window', (n) => ({ ...n, window: w }), final ? undefined : `grade-${clip.id}-win`)}
        />
        <div className="insp__row">
          <button type="button" className="btn btn--sm" onClick={() => actions.addEffect([clip.id], 'lut')}>
            + LUT
          </button>
          <button type="button" className="btn btn--sm" onClick={() => actions.addEffect([clip.id], 'vignette')}>
            <Plus />
            Vignette
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
              const color = clip.effects.filter((e) => COLOR_TYPES.includes(e.type));
              actions.update(
                same.map((c) => c.id),
                'Match color',
                (c) => ({
                  ...c,
                  effects: [...c.effects.filter((e) => !COLOR_TYPES.includes(e.type)), ...color.map((e) => ({ ...structuredClone(e), id: `${e.id}-${c.id}` }))],
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

/**
 * The grade's nodes as boxes joined by lines, from the clip's picture (left)
 * to what is shown (right). Groups stack their nodes, with the mix at the end.
 * Drag a box (or a group) to another place in the chain to move it.
 */
function NodeGraph({
  grade,
  chosen,
  onChoose,
  onToggle,
  onRename,
  onMove,
  onMix,
}: {
  grade: Grade;
  chosen: string;
  onChoose: (id: string) => void;
  onToggle: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onMove: (from: number, to: number) => void;
  onMix: (step: number, kind: MixKind) => void;
}) {
  const [naming, setNaming] = useState<string | null>(null);
  const box = (n: GradeNode) => (
    <div
      key={n.id}
      role="button"
      tabIndex={0}
      className={`gnode${n.id === chosen ? ' is-on' : ''}${n.on ? '' : ' is-off'}`}
      title="Click to choose, double-click to name"
      onClick={() => onChoose(n.id)}
      onDoubleClick={() => setNaming(n.id)}
      onKeyDown={(e) => e.key === 'Enter' && onChoose(n.id)}
    >
      <span className="gnode__num">{nodeNumber(grade, n.id)}</span>
      {naming === n.id ? (
        <input
          className="gnode__name"
          autoFocus
          defaultValue={n.label}
          aria-label="Node name"
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            if (e.target.value !== n.label) onRename(n.id, e.target.value.trim());
            setNaming(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setNaming(null);
          }}
        />
      ) : (
        <span className="gnode__label">{n.label || 'Node'}</span>
      )}
      <span className="gnode__tags">
        {n.qualifier && <i title="Qualifier">Q</i>}
        {n.window && <i title="Window">W</i>}
      </span>
      <input
        type="checkbox"
        checked={n.on}
        title="On / bypass"
        aria-label={`Node ${nodeNumber(grade, n.id)} on`}
        onClick={(e) => e.stopPropagation()}
        onChange={() => onToggle(n.id)}
      />
    </div>
  );
  return (
    <div className="ngraph">
      <span className="ngraph__end">Clip</span>
      {grade.steps.map((s, i) => (
        <Fragment key={s.kind === 'serial' ? s.node.id : s.id}>
          <i className="ngraph__wire" />
          <div
            className={`ngraph__step ngraph__step--${s.kind}`}
            draggable={naming === null}
            onDragStart={(e) => e.dataTransfer.setData('text/x-grade-step', String(i))}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = Number(e.dataTransfer.getData('text/x-grade-step'));
              if (Number.isInteger(from) && e.dataTransfer.getData('text/x-grade-step') !== '') onMove(from, i);
            }}
          >
            {s.kind === 'serial' ? (
              box(s.node)
            ) : (
              <>
                {/* A layer mix shows its top node at the top. */}
                <div className="ngraph__group">{(s.kind === 'layer' ? [...s.nodes].reverse() : s.nodes).map(box)}</div>
                <button
                  type="button"
                  className="ngraph__mix"
                  title={
                    s.kind === 'parallel'
                      ? 'Parallel: each node starts from the same picture, and their changes are added up. Click for a layer mix.'
                      : 'Layer: each node covers the ones under it where its qualifier or window lets it. Click for a parallel mix.'
                  }
                  onClick={() => onMix(i, s.kind === 'parallel' ? 'layer' : 'parallel')}
                >
                  {s.kind === 'parallel' ? 'Parallel' : 'Layer'}
                </button>
              </>
            )}
          </div>
        </Fragment>
      ))}
      <i className="ngraph__wire" />
      <span className="ngraph__end">Out</span>
    </div>
  );
}

/** A number with its name, dragged or typed (not keyframed). */
function NumRow({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number, final: boolean) => void;
}) {
  return (
    <div className="insp__row">
      <span className="field__label">{label}</span>
      <Scrub value={value} min={min} max={max} step={step} unit={unit} label={label} onChange={onChange} />
    </div>
  );
}

function MatteSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="insp__row">
      <span className="field__label">Show matte</span>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** The node only changes colors in a range of hue, saturation and brightness. */
function QualifierControls({
  q,
  showMatte,
  onMatte,
  onChange,
}: {
  q: Qualifier | null;
  showMatte: boolean;
  onMatte: (v: boolean) => void;
  onChange: (q: Qualifier | null, final: boolean) => void;
}) {
  const set = (k: keyof Qualifier) => (v: number, final: boolean) => q && onChange({ ...q, [k]: v }, final);
  return (
    <Section title="Qualifier (pick colors)" open={!!q}>
      <label className="insp__row">
        <span className="field__label">Use a qualifier</span>
        <input type="checkbox" checked={!!q} onChange={(e) => onChange(e.target.checked ? { ...DEFAULT_QUALIFIER } : null, true)} />
      </label>
      {q && (
        <>
          <NumRow label="Hue" value={q.hue} min={0} max={360} unit="°" onChange={set('hue')} />
          <NumRow label="Hue width" value={q.hueWidth} min={1} max={360} unit="°" onChange={set('hueWidth')} />
          <NumRow label="Saturation from" value={q.satLo} min={0} max={100} onChange={set('satLo')} />
          <NumRow label="Saturation to" value={q.satHi} min={0} max={100} onChange={set('satHi')} />
          <NumRow label="Brightness from" value={q.lumLo} min={0} max={100} onChange={set('lumLo')} />
          <NumRow label="Brightness to" value={q.lumHi} min={0} max={100} onChange={set('lumHi')} />
          <NumRow label="Softness" value={q.soft} min={0} max={100} onChange={set('soft')} />
          <label className="insp__row">
            <span className="field__label">Invert</span>
            <input type="checkbox" checked={q.invert} onChange={(e) => onChange({ ...q, invert: e.target.checked }, true)} />
          </label>
          <MatteSwitch on={showMatte} onChange={onMatte} />
        </>
      )}
    </Section>
  );
}

/** The node only changes part of the frame: inside (or outside) a circle or rectangle. */
function WindowControls({
  w,
  showMatte,
  onMatte,
  onChange,
}: {
  w: GradeWindow | null;
  showMatte: boolean;
  onMatte: (v: boolean) => void;
  onChange: (w: GradeWindow | null, final: boolean) => void;
}) {
  const pct = (k: 'x' | 'y' | 'w' | 'h') => (v: number, final: boolean) => w && onChange({ ...w, [k]: v / 100 }, final);
  return (
    <Section title="Window (part of the frame)" open={!!w}>
      <label className="insp__row">
        <span className="field__label">Use a window</span>
        <input type="checkbox" checked={!!w} onChange={(e) => onChange(e.target.checked ? { ...DEFAULT_WINDOW } : null, true)} />
      </label>
      {w && (
        <>
          <div className="insp__row">
            <span className="field__label">Shape</span>
            <Choice
              value={w.shape}
              options={[
                ['circle', 'Circle'],
                ['rect', 'Rectangle'],
              ]}
              onChange={(shape) => onChange({ ...w, shape }, true)}
              label="Window shape"
            />
          </div>
          <NumRow label="Center ↔" value={Math.round(w.x * 1000) / 10} min={-50} max={150} step={0.5} unit="%" onChange={pct('x')} />
          <NumRow label="Center ↕" value={Math.round(w.y * 1000) / 10} min={-50} max={150} step={0.5} unit="%" onChange={pct('y')} />
          <NumRow label="Width" value={Math.round(w.w * 1000) / 10} min={1} max={400} step={0.5} unit="%" onChange={pct('w')} />
          <NumRow label="Height" value={Math.round(w.h * 1000) / 10} min={1} max={200} step={0.5} unit="%" onChange={pct('h')} />
          <NumRow label="Softness" value={w.soft} min={0} max={100} onChange={(v, final) => onChange({ ...w, soft: v }, final)} />
          <label className="insp__row">
            <span className="field__label">Invert (outside)</span>
            <input type="checkbox" checked={w.invert} onChange={(e) => onChange({ ...w, invert: e.target.checked }, true)} />
          </label>
          <MatteSwitch on={showMatte} onChange={onMatte} />
        </>
      )}
    </Section>
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
  const size = 104;
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
    ctx.strokeStyle = '#262626';
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo((W * i) / 4, 0);
      ctx.lineTo((W * i) / 4, H);
      ctx.moveTo(0, (H * i) / 4);
      ctx.lineTo(W, (H * i) / 4);
      ctx.stroke();
    }
    ctx.strokeStyle = '#3a3a3a';
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
          <RotateCcw />
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
        <Activity />
        <span className="scopes__title">Scopes</span>
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
  ctx.fillStyle = '#000';
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
