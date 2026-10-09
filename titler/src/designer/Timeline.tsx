// The timeline: layer bars, keyframes on each property, the IN / HOLD / OUT
// markers and the loop, cue markers, and the playhead. A second tab shows the
// graph editor for the property chosen.

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { RamPreview } from './ramPreview';
import { RAM_CHOICES, ramSetting, setRamSetting } from './frameCache';
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, Unlock, Diamond, Clock } from 'lucide-react';
import { isAnimated, removeKey, setKey, toggleKeys, valueAt } from '../core/easing';
import { cleanMarkers } from '../core/timeline';
import type { Composition, Keyframe, Layer, Value } from '../core/types';
import { uid } from '../core/build';
import { compOf, mapLayers, moveBefore, updateComp, updateLayers } from './ops';
import { animatedProps, getProp, layerKeyTimes, propsOf, withProp, type PropInfo } from './props';
import type { KeyRef, Store } from './store';
import { useStore } from './store';
import { GraphEditor } from './GraphEditor';
import { NumberField } from './fields';

const LEFT = 300;
const ROW = 24;

export function timecode(t: number, fps: number): string {
  const f = Math.round(t * fps);
  const s = Math.floor(f / fps);
  const fr = f % Math.round(fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}:${String(fr).padStart(2, '0')}`;
}

/** The RAM preview's frames as a green bar along the ruler (like After Effects). */
function CachedBar({ ram, fps, zoom }: { ram: RamPreview; fps: number; zoom: number }) {
  const [runs, setRuns] = useState(() => ram.cache.runs());
  useEffect(() => {
    let raf = 0;
    const un = ram.cache.subscribe(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setRuns(ram.cache.runs()));
    });
    return () => {
      un();
      cancelAnimationFrame(raf);
    };
  }, [ram]);
  return (
    <div className="tt-cached" data-testid="titler-cached" aria-hidden="true">
      {runs.map(([a, b]) => (
        <i key={a} style={{ left: (a / fps) * zoom, width: Math.max(1, ((b + 1 - a) / fps) * zoom) }} />
      ))}
    </div>
  );
}

export function Timeline({ store, ram }: { store: Store; ram?: RamPreview | null }) {
  const [ramMb, setRamMb] = useState(ramSetting);
  const project = useStore(store, (s) => s.project);
  const compId = useStore(store, (s) => s.compId);
  const time = useStore(store, (s) => s.time);
  const selection = useStore(store, (s) => s.selection);
  const keys = useStore(store, (s) => s.keys);
  const open = useStore(store, (s) => s.open);
  const zoom = useStore(store, (s) => s.timelineZoom);
  const graph = useStore(store, (s) => s.graphProp);
  const [tab, setTab] = useState<'layers' | 'graph'>('layers');
  const c = compOf(project, compId);
  const scroller = useRef<HTMLDivElement>(null);
  const width = Math.max(400, c.duration * zoom + 40);
  // Stable while only the playhead moves, so the rows (memoized) aren't drawn again 60 times a second.
  const x = useCallback((t: number) => t * zoom, [zoom]);
  const tAt = (clientX: number) => {
    const el = scroller.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(c.duration, Math.max(0, (clientX - r.left - LEFT + el.scrollLeft) / zoom));
  };
  const frame = (t: number) => Math.round(t * c.fps) / c.fps;

  const scrub = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const go = (ev: { clientX: number }) => store.set({ time: frame(tAt(ev.clientX)), cue: null });
    go(e);
    const move = (ev: PointerEvent) => go(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Drag something in time: `fn` gets the time moved (seconds, snapped to frames). */
  const latest = useRef({ tAt, frame });
  latest.current = { tAt, frame };
  const dragTime = useCallback(
    (e: React.PointerEvent, label: string, fn: (dt: number, ev: PointerEvent) => void) => {
      e.stopPropagation();
      const { tAt, frame } = latest.current;
      const t0 = tAt(e.clientX);
      store.begin(label);
      const move = (ev: PointerEvent) => fn(frame(tAt(ev.clientX)) - frame(t0), ev);
      const up = () => {
        store.end();
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [store],
  );

  const setMarkers = (fn: (m: Composition['markers']) => Composition['markers']) =>
    store.edit('Move marker', (p) => updateComp(p, c.id, (cc) => ({ ...cc, markers: cleanMarkers(fn(cc.markers), cc.duration) })));

  const rows: ReactNode[] = [];
  const walk = (list: Layer[], depth: number) => {
    for (const l of list) {
      rows.push(
        <LayerRow
          key={l.id}
          store={store}
          c={c}
          l={l}
          depth={depth}
          x={x}
          selected={selection.includes(l.id)}
          keys={keys}
          open={open[l.id]}
          dragTime={dragTime}
        />,
      );
      const mode = open[l.id];
      if (mode) {
        const props = mode === 'animated' ? animatedProps(l) : propsOf(l);
        for (const pi of props)
          rows.push(
            <PropRow
              key={`${l.id}:${pi.path}`}
              store={store}
              c={c}
              l={l}
              pi={pi}
              depth={depth}
              x={x}
              time={time}
              keys={keys}
              dragTime={dragTime}
              graph={graph}
            />,
          );
      }
      if (l.type === 'group') walk(l.children, depth + 1);
    }
  };
  walk(c.layers, 0);

  const { inEnd, outStart, loop } = c.markers;
  return (
    <div className="tt-timeline" data-testid="titler-timeline">
      <div className="tt-tl-tabs">
        <button className={tab === 'layers' ? 'on' : ''} onClick={() => setTab('layers')}>
          Timeline
        </button>
        <button className={tab === 'graph' ? 'on' : ''} onClick={() => setTab('graph')} title="Easing and values of the chosen property">
          Graph editor
        </button>
        <span className="tt-tc" title="Playhead (minutes:seconds:frames)">
          {timecode(time, c.fps)}
        </span>
        <span className="tt-dim">
          {c.fps} fps · {c.duration.toFixed(2)} s
        </span>
        <span className="tt-grow" />
        {ram && (
          <label className="tt-dim tt-zoomlabel" title="Memory for the RAM preview: frames made ahead so playback holds full speed (the green bar)">
            Preview memory
            <select
              className="tt-select"
              aria-label="Preview memory"
              value={ramMb}
              onChange={(e) => {
                const mb = Number(e.target.value);
                setRamMb(mb);
                setRamSetting(mb);
                ram.setCapMb(mb);
              }}
            >
              {RAM_CHOICES.map((mb) => (
                <option key={mb} value={mb}>
                  {mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="tt-dim tt-zoomlabel">
          Zoom
          <input
            type="range"
            min={20}
            max={600}
            value={zoom}
            onChange={(e) => store.set({ timelineZoom: Number(e.target.value) })}
            aria-label="Timeline zoom"
          />
        </label>
      </div>
      {tab === 'graph' ? (
        <GraphEditor store={store} />
      ) : (
        <div className="tt-tl-body" ref={scroller}>
          <div className="tt-tl-inner" style={{ width: LEFT + width }}>
            <div className="tt-tl-head">
              <div className="tt-tl-left tt-tl-phases">
                <span className="tt-phase in">IN</span>
                <span className="tt-phase hold">HOLD</span>
                <span className="tt-phase out">OUT</span>
                <button
                  className="tt-link"
                  title="Repeat part of HOLD while the graphic is on air"
                  onClick={() => setMarkers((m) => ({ ...m, loop: m.loop ? null : { start: m.inEnd, end: Math.min(m.outStart, m.inEnd + 2) } }))}
                >
                  {loop ? 'Remove loop' : 'Add loop'}
                </button>
                <button
                  className="tt-link"
                  title="A cue marker (an audio cue or a note) at the playhead"
                  onClick={() =>
                    store.edit('Add cue marker', (p) =>
                      updateComp(p, c.id, (cc) => ({
                        ...cc,
                        cues: [...cc.cues, { id: uid('m'), t: time, name: `Cue ${cc.cues.length + 1}` }].sort((a, b) => a.t - b.t),
                      })),
                    )
                  }
                >
                  Add cue
                </button>
              </div>
              <div className="tt-tl-ruler" style={{ width }} onPointerDown={scrub}>
                <Ruler duration={c.duration} zoom={zoom} fps={c.fps} />
                {ram && <CachedBar ram={ram} fps={c.fps} zoom={zoom} />}
                <div className="tt-seg in" style={{ left: 0, width: x(inEnd) }} />
                <div className="tt-seg hold" style={{ left: x(inEnd), width: x(outStart - inEnd) }} />
                <div className="tt-seg out" style={{ left: x(outStart), width: x(c.duration - outStart) }} />
                {loop && (
                  <div
                    className="tt-loop"
                    style={{ left: x(loop.start), width: x(loop.end - loop.start) }}
                    onPointerDown={(e) =>
                      dragTime(e, 'Move loop', (dt) => setMarkers((m) => (m.loop ? { ...m, loop: { start: loop.start + dt, end: loop.end + dt } } : m)))
                    }
                  />
                )}
                <Marker
                  at={x(inEnd)}
                  label="IN ends"
                  cls="in"
                  onDown={(e) => dragTime(e, 'Move IN marker', (dt) => setMarkers((m) => ({ ...m, inEnd: inEnd + dt })))}
                />
                <Marker
                  at={x(outStart)}
                  label="OUT starts"
                  cls="out"
                  onDown={(e) => dragTime(e, 'Move OUT marker', (dt) => setMarkers((m) => ({ ...m, outStart: outStart + dt })))}
                />
                {loop && (
                  <>
                    <Marker
                      at={x(loop.start)}
                      label="Loop start"
                      cls="loop"
                      onDown={(e) => dragTime(e, 'Move loop', (dt) => setMarkers((m) => (m.loop ? { ...m, loop: { ...m.loop, start: loop.start + dt } } : m)))}
                    />
                    <Marker
                      at={x(loop.end)}
                      label="Loop end"
                      cls="loop"
                      onDown={(e) => dragTime(e, 'Move loop', (dt) => setMarkers((m) => (m.loop ? { ...m, loop: { ...m.loop, end: loop.end + dt } } : m)))}
                    />
                  </>
                )}
                {c.cues.map((q) => (
                  <div
                    key={q.id}
                    className="tt-cue"
                    style={{ left: x(q.t) }}
                    title={`${q.name}${q.sound ? ' (sound)' : ''}. Drag to move; double-click to remove.`}
                    onDoubleClick={() =>
                      store.edit('Remove cue marker', (p) => updateComp(p, c.id, (cc) => ({ ...cc, cues: cc.cues.filter((x2) => x2.id !== q.id) })))
                    }
                    onPointerDown={(e) =>
                      dragTime(e, 'Move cue marker', (dt) =>
                        store.edit('Move cue marker', (p) =>
                          updateComp(p, c.id, (cc) => ({
                            ...cc,
                            cues: cc.cues.map((x2) => (x2.id === q.id ? { ...x2, t: Math.min(cc.duration, Math.max(0, q.t + dt)) } : x2)),
                          })),
                        ),
                      )
                    }
                  >
                    {q.name}
                  </div>
                ))}
                <div className="tt-playhead" style={{ left: x(time) }} />
              </div>
            </div>
            <div className="tt-tl-rows">
              {rows}
              {!rows.length && <div className="tt-empty">No layers yet. Add text or a shape from the toolbar, or start from a template.</div>}
              <div className="tt-playhead tall" style={{ left: LEFT + x(time) }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Ruler({ duration, zoom, fps }: { duration: number; zoom: number; fps: number }) {
  const step = [1 / fps, 0.1, 0.25, 0.5, 1, 2, 5, 10].find((s) => s * zoom >= 60) ?? 10;
  const ticks: ReactNode[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) {
    ticks.push(
      <span key={t.toFixed(4)} className="tt-tick" style={{ left: t * zoom }}>
        {step < 1 ? `${t.toFixed(step < 0.1 ? 2 : 1)}` : `${Math.round(t)}s`}
      </span>,
    );
  }
  return <>{ticks}</>;
}

function Marker({ at, label, cls, onDown }: { at: number; label: string; cls: string; onDown: (e: React.PointerEvent) => void }) {
  return <div className={`tt-marker ${cls}`} style={{ left: at }} title={`${label} (drag)`} aria-label={label} onPointerDown={onDown} />;
}

interface RowProps {
  store: Store;
  c: Composition;
  l: Layer;
  depth: number;
  x: (t: number) => number;
  keys: KeyRef[];
  dragTime: (e: React.PointerEvent, label: string, fn: (dt: number, ev: PointerEvent) => void) => void;
}

const LABELS = ['#8f8f8a', '#c45d5d', '#c9a04a', '#5f9e6e', '#5b8fbf', '#8d77c4'];

const LayerRow = memo(function LayerRow({
  store,
  c,
  l,
  depth,
  x,
  selected,
  open,
  dragTime,
}: RowProps & { selected: boolean; open: 'all' | 'animated' | undefined }) {
  const [renaming, setRenaming] = useState(false);
  const select = (e: React.MouseEvent) => {
    const s = store.get();
    if (e.shiftKey || e.metaKey || e.ctrlKey)
      store.set({ selection: s.selection.includes(l.id) ? s.selection.filter((x2) => x2 !== l.id) : [...s.selection, l.id] });
    else store.set({ selection: [l.id] });
  };
  const toggle = (f: 'visible' | 'locked') =>
    store.edit(f === 'visible' ? 'Show or hide layer' : 'Lock layer', (p) => updateLayers(p, c.id, [l.id], (x2) => ({ ...x2, [f]: !x2[f] })));
  const keyTimes = open ? [] : layerKeyTimes(l);
  const barDrag = (e: React.PointerEvent, part: 'move' | 'start' | 'end') => {
    select(e);
    const s0 = l.start;
    const e0 = l.end;
    dragTime(e, part === 'move' ? 'Move layer in time' : 'Trim layer', (dt) =>
      store.edit('Move layer in time', (p) =>
        updateLayers(p, c.id, [l.id], (x2) => {
          if (part === 'start') return { ...x2, start: Math.min(e0 - 1 / c.fps, Math.max(0, s0 + dt)) };
          if (part === 'end') return { ...x2, end: Math.max(s0 + 1 / c.fps, Math.min(c.duration, e0 + dt)) };
          const d = Math.min(c.duration - e0, Math.max(-s0, dt));
          // The layer's keys move with it.
          return shiftKeys({ ...x2, start: s0 + d, end: e0 + d }, l, d);
        }),
      ),
    );
  };
  return (
    <div className={`tt-row layer${selected ? ' sel' : ''}`} style={{ height: ROW }}>
      <div
        className="tt-tl-left"
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={select}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/x-titler-layer', l.id)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const id = e.dataTransfer.getData('text/x-titler-layer');
          if (id && id !== l.id) store.edit('Reorder layers', (p) => moveBefore(p, c.id, id, l.id));
        }}
      >
        <button
          className="tt-ico"
          onClick={(e) => (e.stopPropagation(), store.set((s) => ({ open: toggleOpen(s.open, l.id, 'all') })))}
          aria-label={open ? 'Close properties' : 'Show properties'}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span
          className="tt-label"
          style={{ background: l.label ?? LABELS[l.type === 'text' ? 4 : l.type === 'shape' ? 2 : l.type === 'image' ? 3 : 0] }}
          title="Label color (click to change)"
          onClick={(e) => {
            e.stopPropagation();
            const i = LABELS.indexOf(l.label ?? '');
            store.edit('Label color', (p) => updateLayers(p, c.id, [l.id], (x2) => ({ ...x2, label: LABELS[(i + 1) % LABELS.length] })));
          }}
        />
        <button
          className="tt-ico"
          onClick={(e) => (e.stopPropagation(), toggle('visible'))}
          aria-label={l.visible ? 'Hide layer' : 'Show layer'}
          title={l.visible ? 'Hide' : 'Show'}
        >
          {l.visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
        <button
          className="tt-ico"
          onClick={(e) => (e.stopPropagation(), toggle('locked'))}
          aria-label={l.locked ? 'Unlock layer' : 'Lock layer'}
          title={l.locked ? 'Unlock' : 'Lock'}
        >
          {l.locked ? <Lock size={12} /> : <Unlock size={12} className="tt-faint" />}
        </button>
        {renaming ? (
          <input
            className="tt-rename"
            autoFocus
            defaultValue={l.name}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const name = e.target.value.trim() || l.name;
              setRenaming(false);
              if (name !== l.name) store.edit('Rename layer', (p) => updateLayers(p, c.id, [l.id], (x2) => ({ ...x2, name })));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <span className="tt-name" onDoubleClick={() => setRenaming(true)} title={`${l.name} (${l.type}). Double-click to rename.`}>
            {l.name}
          </span>
        )}
        {l.parent && (
          <span className="tt-badge" title="Has a parent layer">
            ↳
          </span>
        )}
        {l.matte && (
          <span className="tt-badge" title="Seen through a track matte">
            M
          </span>
        )}
      </div>
      <div className="tt-tl-track">
        <div className={`tt-bar ${l.type}`} style={{ left: x(l.start), width: Math.max(2, x(l.end - l.start)) }} onPointerDown={(e) => barDrag(e, 'move')}>
          <span className="tt-bar-edge start" onPointerDown={(e) => barDrag(e, 'start')} />
          <span className="tt-bar-edge end" onPointerDown={(e) => barDrag(e, 'end')} />
        </div>
        {keyTimes.map((t) => (
          <span key={t} className="tt-key small" style={{ left: x(t) }} />
        ))}
      </div>
    </div>
  );
});

/** Open a layer's properties (all, or only the animated ones), or close them. */
export function toggleOpen(open: Record<string, 'all' | 'animated'>, id: string, mode: 'all' | 'animated'): Record<string, 'all' | 'animated'> {
  const next = { ...open };
  if (next[id] === mode) delete next[id];
  else next[id] = mode;
  return next;
}

function shiftKeys(l: Layer, orig: Layer, d: number): Layer {
  let next = l;
  for (const pi of propsOf(orig)) {
    const p = getProp(orig, pi.path);
    if (isAnimated(p)) next = withProp(next, pi.path, { k: p.k.map((k) => ({ ...k, t: k.t + d })) });
  }
  return next;
}

function PropRow({
  store,
  c,
  l,
  pi,
  depth,
  x,
  time,
  keys,
  dragTime,
  graph,
}: RowProps & { pi: PropInfo; time: number; graph: { layer: string; path: string } | null }) {
  const p = getProp(l, pi.path);
  const anim = isAnimated(p);
  const value = valueAt(p as never, time, pi.fallback as never) as Value;
  const set = (v: Value) =>
    store.edit(`Change ${pi.label.toLowerCase()}`, (pr) =>
      updateLayers(pr, c.id, [l.id], (x2) => withProp(x2, pi.path, anim ? setKey(getProp(x2, pi.path) as never, time, v as never) : { v })),
    );
  const stopwatch = () =>
    store.edit(anim ? 'Remove keyframes' : 'Add keyframes', (pr) =>
      updateLayers(pr, c.id, [l.id], (x2) => withProp(x2, pi.path, toggleKeys(getProp(x2, pi.path) as never, time, pi.fallback as never))),
    );
  const keyHere = anim && p.k.some((k) => Math.abs(k.t - time) < 1e-4);
  const addOrRemove = () =>
    store.edit(keyHere ? 'Remove keyframe' : 'Add keyframe', (pr) =>
      updateLayers(pr, c.id, [l.id], (x2) => {
        const cur = getProp(x2, pi.path);
        if (keyHere) return withProp(x2, pi.path, removeKey(cur as never, time, pi.fallback as never));
        return withProp(x2, pi.path, setKey(cur as never, time, valueAt(cur as never, time, pi.fallback as never)));
      }),
    );
  const jump = (dir: -1 | 1) => {
    if (!anim) return;
    const ts = p.k.map((k) => k.t);
    const next = dir > 0 ? ts.find((t) => t > time + 1e-4) : [...ts].reverse().find((t) => t < time - 1e-4);
    if (next !== undefined) store.set({ time: next, cue: null });
  };
  const isSel = (k: Keyframe<Value>) => keys.some((r) => r.layer === l.id && r.path === pi.path && Math.abs(r.t - k.t) < 1e-6);
  const keyDown = (e: React.PointerEvent, k: Keyframe<Value>) => {
    const s = store.get();
    const ref = { layer: l.id, path: pi.path, t: k.t };
    let sel = s.keys;
    if (e.shiftKey) sel = isSel(k) ? sel.filter((r) => !(r.layer === l.id && r.path === pi.path && Math.abs(r.t - k.t) < 1e-6)) : [...sel, ref];
    else if (!isSel(k)) sel = [ref];
    store.set({ keys: sel, graphProp: { layer: l.id, path: pi.path }, selection: s.selection.includes(l.id) ? s.selection : [l.id] });
    const startProject = store.get().project;
    const moving = sel;
    dragTime(e, 'Move keyframes', (dt) => {
      store.edit('Move keyframes', () => moveKeys(startProject, c.id, moving, dt));
      store.set({ keys: moving.map((r) => ({ ...r, t: Math.round((r.t + dt) * 1e6) / 1e6 })) });
    });
  };
  return (
    <div className={`tt-row prop${graph?.layer === l.id && graph.path === pi.path ? ' graphed' : ''}`} style={{ height: ROW }}>
      <div className="tt-tl-left" style={{ paddingLeft: 22 + depth * 14 }} onClick={() => store.set({ graphProp: { layer: l.id, path: pi.path } })}>
        <button
          className={`tt-ico${anim ? ' on' : ''}`}
          onClick={(e) => (e.stopPropagation(), stopwatch())}
          title={anim ? 'Stop animating (keeps the value here)' : 'Animate (a keyframe here)'}
          aria-label={`Animate ${pi.label}`}
        >
          <Clock size={12} />
        </button>
        <span className="tt-propname">{pi.label}</span>
        <span className="tt-propval">
          {Array.isArray(value) ? (
            <>
              <NumberField
                value={value[0]}
                step={pi.step ?? 1}
                onChange={(v) => set([v, (value as number[])[1]!])}
                onBegin={() => store.begin(pi.label)}
                onEnd={() => store.end()}
                label={`${pi.label} x`}
              />
              <NumberField
                value={value[1]}
                step={pi.step ?? 1}
                onChange={(v) => set([(value as number[])[0]!, v])}
                onBegin={() => store.begin(pi.label)}
                onEnd={() => store.end()}
                label={`${pi.label} y`}
              />
            </>
          ) : (
            <NumberField
              value={value}
              step={pi.step ?? 1}
              min={pi.min}
              max={pi.max}
              onChange={(v) => set(v)}
              onBegin={() => store.begin(pi.label)}
              onEnd={() => store.end()}
              label={pi.label}
            />
          )}
        </span>
        {anim && (
          <span className="tt-keynav">
            <button className="tt-ico" onClick={(e) => (e.stopPropagation(), jump(-1))} aria-label="Previous keyframe">
              ‹
            </button>
            <button
              className={`tt-ico${keyHere ? ' on' : ''}`}
              onClick={(e) => (e.stopPropagation(), addOrRemove())}
              aria-label={keyHere ? 'Remove keyframe here' : 'Add keyframe here'}
            >
              <Diamond size={10} />
            </button>
            <button className="tt-ico" onClick={(e) => (e.stopPropagation(), jump(1))} aria-label="Next keyframe">
              ›
            </button>
          </span>
        )}
      </div>
      <div className="tt-tl-track">
        {anim &&
          p.k.map((k) => (
            <span
              key={k.t}
              className={`tt-key${isSel(k) ? ' sel' : ''}${k.hold ? ' hold' : k.o || k.i ? ' eased' : ''}`}
              style={{ left: x(k.t) }}
              title={`${pi.label} at ${k.t.toFixed(2)} s`}
              onPointerDown={(e) => keyDown(e, k)}
              onDoubleClick={() => store.set({ time: k.t, cue: null })}
            />
          ))}
      </div>
    </div>
  );
}

/** Move keyframes in time (from the project as it was when the drag started). */
export function moveKeys(p: ReturnType<Store['get']>['project'], compId: string, refs: KeyRef[], dt: number) {
  const byLayer = new Map<string, KeyRef[]>();
  for (const r of refs) byLayer.set(r.layer, [...(byLayer.get(r.layer) ?? []), r]);
  return updateComp(p, compId, (c) => ({
    ...c,
    layers: mapLayers(c.layers, (l) => {
      const mine = byLayer.get(l.id);
      if (!mine) return l;
      let next = l;
      const paths = new Set(mine.map((r) => r.path));
      for (const path of paths) {
        const prop = getProp(next, path);
        if (!isAnimated(prop)) continue;
        const ts = mine.filter((r) => r.path === path).map((r) => r.t);
        const moved = prop.k.map((k) => (ts.some((t) => Math.abs(t - k.t) < 1e-6) ? { ...k, t: Math.max(0, Math.round((k.t + dt) * 1e6) / 1e6) } : k));
        // Two keys on the same time: the moved one wins.
        const out = moved.filter(
          (k, i) =>
            !moved.some(
              (o, j) =>
                j !== i && Math.abs(o.t - k.t) < 1e-6 && ts.some((t) => Math.abs(t + dt - o.t) < 1e-6) && !ts.some((t) => Math.abs(t + dt - k.t) < 1e-6),
            ),
        );
        out.sort((a, b) => a.t - b.t);
        next = withProp(next, path, { k: out });
      }
      return next;
    }),
  }));
}
