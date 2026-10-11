// The Composite page: a clip's picture made by nodes (as in Fusion). The
// viewer shows the result (or any one node's picture), the inspector the
// chosen node's settings (keyframed like any effect), and the canvas below
// the graph: drag from an output to an input to join them, drag a node by its
// title, right-click for new nodes, Delete to take the chosen one out.
import { Eye, Layers, Maximize2, Plus, Trash2, Workflow } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { effectDef } from '../model/effects';
import {
  addNode,
  connect,
  graphOf,
  moveNode,
  NODE_DEFS,
  NODE_EFFECTS,
  newCompositeEffect,
  nodeInputs,
  nodeName,
  nodeParams,
  paramKey,
  removeNode,
  updateNode,
  type CompGraph,
  type CompNode,
  type NodeKind,
} from '../model/nodes';
import { current, end } from '../model/seq';
import type { Clip, Effect, Param } from '../model/types';
import { selectedIds, useDoc, type Doc } from '../doc';
import type { Engine } from '../player/engine';
import type { Actions } from './actions';
import { Choice, ColorField, ParamRow, PopMenu, Section, type MenuEntry } from './controls';
import { usePlayhead } from './hooks';
import { useUi, type Ui } from './state';
import './composite.css';

const NODE_W = 156;
const HEAD = 26;
const ROW = 20;
const nodeHeight = (n: CompNode): number => HEAD + Math.max(1, nodeInputs(n).length) * ROW + 8;
const inPort = (n: CompNode, i: number): [number, number] => [n.x, n.y + HEAD + 4 + ROW * i + ROW / 2];
const outPort = (n: CompNode): [number, number] => [n.x + NODE_W, n.y + HEAD + 4 + ROW / 2];
const wire = ([x1, y1]: [number, number], [x2, y2]: [number, number]): string => {
  const dx = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
};

/** The view's offset that centers every node. */
function fitPan(g: CompGraph, w: number, h: number): { x: number; y: number } {
  if (!g.nodes.length) return { x: 24, y: 24 };
  const minX = Math.min(...g.nodes.map((n) => n.x));
  const minY = Math.min(...g.nodes.map((n) => n.y));
  const maxX = Math.max(...g.nodes.map((n) => n.x + NODE_W));
  const maxY = Math.max(...g.nodes.map((n) => n.y + nodeHeight(n)));
  return { x: Math.round((w - (maxX - minX)) / 2 - minX), y: Math.round(Math.max(16, (h - (maxY - minY)) / 2) - minY) };
}

/** The clip the page works on: the selected picture clip, else the top one at the playhead. */
export function compositeClip(doc: Doc, frame: number): Clip | undefined {
  const s = current(doc.project);
  const ids = selectedIds(doc.state.selection);
  const isVideo = (c: Clip) => s.tracks.find((t) => t.id === c.track)?.kind === 'video' && c.source.kind !== 'caption';
  const sel = s.clips.find((c) => ids.includes(c.id) && isVideo(c));
  if (sel) return sel;
  return s.tracks
    .filter((t) => t.kind === 'video' && !t.off && !t.captions)
    .reverse()
    .map((t) => s.clips.find((c) => c.track === t.id && frame >= c.start && frame < end(c) && c.source.kind !== 'adjustment'))
    .find(Boolean);
}

const compositeOf = (c: Clip | undefined): Effect | undefined => c?.effects.find((e) => e.type === 'nodes');

/** Changes to a clip's composite, each one a step to undo. */
function useComposite(doc: Doc, actions: Actions, clip: Clip | undefined) {
  const fx = compositeOf(clip);
  const change = (label: string, f: (e: Effect) => Effect, key?: string) => {
    if (!clip || !fx) return;
    actions.update([clip.id], label, (c) => ({ ...c, effects: c.effects.map((e) => (e.id === fx.id ? f(e) : e)) }), key);
  };
  const graph = (label: string, f: (g: CompGraph, p: Record<string, Param>) => { graph: CompGraph; p?: Record<string, Param> }, key?: string) =>
    change(
      label,
      (e) => {
        const r = f(graphOf(e), e.p);
        return { ...e, p: r.p ?? e.p, d: { ...e.d, graph: r.graph } };
      },
      key,
    );
  return { fx, change, graph };
}

const SOURCES: [NodeKind, string][] = [
  ['under', 'Background (what is under the clip)'],
  ['in', 'Clip (another copy of its picture)'],
  ['solid', 'Solid color'],
  ['gradient', 'Gradient'],
];
const LAYERING: [NodeKind, string][] = [
  ['merge', 'Merge (layer two pictures)'],
  ['transform', 'Transform'],
  ['mask', 'Shape mask'],
];

/** The "add a node" menu, placing the new node at a point of the canvas. */
function addMenu(onAdd: (kind: NodeKind, fx?: string) => void): MenuEntry[] {
  const groups = new Map<string, MenuEntry[]>();
  for (const e of NODE_EFFECTS) {
    const list = groups.get(e.group) ?? [];
    list.push({ label: e.name, run: () => onAdd('fx', e.type) });
    groups.set(e.group, list);
  }
  return [
    ...SOURCES.map(([k, label]): MenuEntry => ({ label, run: () => onAdd(k) })),
    'sep',
    ...LAYERING.map(([k, label]): MenuEntry => ({ label, run: () => onAdd(k) })),
    'sep',
    ...[...groups].map(([g, items]): MenuEntry => ({ label: g, items: items as never })),
  ];
}

/** The graph, under the viewer. */
export function CompositeGraph({ doc, engine, actions, ui }: { doc: Doc; engine: Engine; actions: Actions; ui: Ui }) {
  useDoc(doc);
  const u = useUi(ui);
  const t = usePlayhead(engine);
  const clip = compositeClip(doc, t);
  const { fx, graph } = useComposite(doc, actions, clip);
  const g = fx ? graphOf(fx) : null;
  const box = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 24, y: 24 });
  const [menu, setMenu] = useState<{ x: number; y: number; at: { x: number; y: number } } | null>(null);
  const [linking, setLinking] = useState<{ from: string; at: [number, number] } | null>(null);
  const [view, setView] = useState<string | null>(null);
  const chosen = g?.nodes.find((n) => n.id === u.compNode) ?? null;
  // Every node in sight when a clip's graph is first shown.
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!g || !el || !clip || shownFor.current === clip.id) return;
    shownFor.current = clip.id;
    setPan(fitPan(g, el.clientWidth, el.clientHeight));
  });

  // The viewer shows one node's picture while its eye is on (and this page is open).
  useEffect(() => {
    engine.setNodeView(clip && view && g?.nodes.some((n) => n.id === view) ? { clip: clip.id, node: view } : null);
  }, [engine, clip, view, g]);
  useEffect(() => () => engine.setNodeView(null), [engine]);

  if (!clip)
    return (
      <div className="comp comp--empty">
        <Workflow />
        <p>Put the playhead over a picture clip (or select one) to build its picture from nodes.</p>
      </div>
    );
  if (!fx || !g)
    return (
      <div className="comp comp--empty">
        <Workflow />
        <p>
          Build <b>{clip.name}</b> from nodes: layer it with what is under it, add masks, keys, transforms and any effect, joined in any order.
        </p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            const e = newCompositeEffect();
            actions.update([clip.id], 'Start a node composite', (c) => ({ ...c, effects: [...c.effects, e] }));
            const out = graphOf(e).nodes.find((n) => n.kind === 'out');
            if (out) ui.set({ compNode: out.id });
          }}
        >
          <Plus />
          Start a node composite
        </button>
      </div>
    );

  const toCanvas = (clientX: number, clientY: number): [number, number] => {
    const r = box.current?.getBoundingClientRect();
    return [clientX - (r?.left ?? 0) - pan.x, clientY - (r?.top ?? 0) - pan.y];
  };
  const add = (at: { x: number; y: number }) => (kind: NodeKind, fxType?: string) => {
    let id = '';
    graph(`Add ${kind === 'fx' ? (effectDef(fxType ?? '')?.name ?? 'effect') : NODE_DEFS[kind].name} node`, (gr, p) => {
      const sel = gr.nodes.find((n) => n.id === u.compNode);
      const feed = sel?.inputs[0] ? gr.nodes.find((n) => n.id === sel.inputs[0]) : undefined;
      // Into the chosen node's chain: halfway between it and what feeds it; otherwise where asked. Never on top of another node.
      const place = sel && feed && NODE_DEFS[kind].inputs.length ? { x: (sel.x + feed.x) / 2, y: (sel.y + feed.y) / 2 } : { ...at };
      while (gr.nodes.some((n) => Math.abs(n.x - place.x) < NODE_W - 20 && Math.abs(n.y - place.y) < 60)) place.y += 70;
      const r = addNode(gr, p, kind, place, fxType);
      id = r.id;
      // Put it in the chosen node's chain: what fed the chosen node now goes through it.
      let next = r.graph;
      if (sel && NODE_DEFS[kind].inputs.length && sel.inputs[0]) {
        next = connect(next, sel.inputs[0], id, 0);
        next = connect(next, id, sel.id, 0);
      } else if (sel && !NODE_DEFS[kind].inputs.length && sel.kind === 'merge' && !sel.inputs[1]) {
        // A picture for a Merge node with no foreground yet.
        next = connect(next, id, sel.id, 1);
      }
      return { graph: next, p: r.p };
    });
    if (id) ui.set({ compNode: id });
  };
  const remove = (id: string) => {
    const n = g.nodes.find((x) => x.id === id);
    if (!n || n.kind === 'out') return;
    graph(`Remove ${nodeName(n)} node`, (gr, p) => {
      // What fed it goes on to what it fed (its first input), so the chain stays joined.
      const r = removeNode(gr, p, id);
      const feed = n.inputs[0] ?? null;
      let next = r.graph;
      if (feed)
        for (const x of next.nodes)
          x.inputs.forEach((v, i) => {
            if (v === null && gr.nodes.find((o) => o.id === x.id)?.inputs[i] === id) next = connect(next, feed, x.id, i);
          });
      return { graph: next, p: r.p };
    });
    if (view === id) setView(null);
    ui.set({ compNode: null });
  };
  const fit = () => {
    const el = box.current;
    if (el) setPan(fitPan(g, el.clientWidth, el.clientHeight));
  };

  const startMove = (e: React.PointerEvent, n: CompNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    ui.set({ compNode: n.id });
    const x0 = e.clientX;
    const y0 = e.clientY;
    const key = `node-move-${n.id}-${Date.now()}`;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      graph('Move node', (gr) => ({ graph: moveNode(gr, n.id, n.x + dx, n.y + dy) }), key);
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };

  /** Drag from an output (or from a joined input, to move or undo that join). */
  const startLink = (e: React.PointerEvent, from: string, detach?: { to: string; input: number }) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setLinking({ from, at: toCanvas(e.clientX, e.clientY) });
    const onMove = (ev: PointerEvent) => setLinking({ from, at: toCanvas(ev.clientX, ev.clientY) });
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLinking(null);
      const port = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('[data-in]') as HTMLElement | null;
      const to = port?.dataset.node;
      const input = Number(port?.dataset.in);
      if (to && Number.isInteger(input)) {
        if (detach && detach.to === to && detach.input === input) return;
        graph('Join nodes', (gr) => {
          let next = detach ? connect(gr, null, detach.to, detach.input) : gr;
          next = connect(next, from, to, input);
          return { graph: next };
        });
      } else if (detach) graph('Unjoin nodes', (gr) => ({ graph: connect(gr, null, detach.to, detach.input) }));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startPan = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    ui.set({ compNode: null });
    const x0 = e.clientX - pan.x;
    const y0 = e.clientY - pan.y;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => setPan({ x: ev.clientX - x0, y: ev.clientY - y0 });
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  };

  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const links = g.nodes.flatMap((n) =>
    n.inputs.flatMap((from, i) => {
      const src = from ? byId.get(from) : undefined;
      return src ? [{ key: `${src.id}>${n.id}.${i}`, d: wire(outPort(src), inPort(n, i)), mask: n.kind === 'merge' && i === 2 }] : [];
    }),
  );
  const linkingFrom = linking ? byId.get(linking.from) : undefined;

  return (
    <div className="comp">
      <div className="comp__bar">
        <span className="comp__title">
          <Workflow />
          Nodes <small>{clip.name}</small>
        </span>
        <button
          type="button"
          className="btn btn--sm"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const sel = chosen ?? g.nodes.find((n) => n.kind === 'out');
            setMenu({ x: r.left, y: r.bottom + 4, at: sel ? { x: sel.x - NODE_W - 40, y: sel.y + 70 } : { x: 200, y: 160 } });
          }}
        >
          <Plus />
          Add node
        </button>
        <button
          type="button"
          className="btn btn--sm"
          disabled={!chosen || chosen.kind === 'out'}
          title="Take the chosen node out (Delete)"
          onClick={() => chosen && remove(chosen.id)}
        >
          <Trash2 />
          Remove
        </button>
        <span className="comp__fill" />
        <span className="comp__hint">Drag from an output dot to an input to join · right-click to add</span>
        <button type="button" className="btn btn--sm" title="See every node" onClick={fit}>
          <Maximize2 />
          Fit
        </button>
      </div>
      <div
        ref={box}
        className="comp__canvas"
        tabIndex={0}
        role="application"
        aria-label="Node graph"
        onPointerDown={startPan}
        onContextMenu={(e) => {
          e.preventDefault();
          const [x, y] = toCanvas(e.clientX, e.clientY);
          setMenu({ x: e.clientX, y: e.clientY, at: { x, y } });
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && chosen) {
            e.preventDefault();
            e.stopPropagation();
            remove(chosen.id);
          }
        }}
      >
        <div className="comp__plane" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          <svg className="comp__wires" width="1" height="1" aria-hidden="true">
            {links.map((l) => (
              <path key={l.key} d={l.d} className={l.mask ? 'is-mask' : ''} />
            ))}
            {linking && linkingFrom && <path d={wire(outPort(linkingFrom), linking.at)} className="is-new" />}
          </svg>
          {g.nodes.map((n) => {
            const ins = nodeInputs(n);
            return (
              <div
                key={n.id}
                className={`cnode cnode--${n.kind}${n.id === u.compNode ? ' is-on' : ''}${n.off ? ' is-off' : ''}`}
                style={{ left: n.x, top: n.y, width: NODE_W, height: nodeHeight(n) }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  ui.set({ compNode: n.id });
                }}
              >
                <div className="cnode__head" onPointerDown={(e) => startMove(e, n)} title={NODE_DEFS[n.kind].about}>
                  <span className="cnode__name">{nodeName(n)}</span>
                  {n.kind !== 'out' && (
                    <button
                      type="button"
                      className={`cnode__eye${view === n.id ? ' is-on' : ''}`}
                      title={view === n.id ? 'Show the output again' : 'Show this node in the viewer'}
                      aria-label={`Show ${nodeName(n)} in the viewer`}
                      aria-pressed={view === n.id}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setView(view === n.id ? null : n.id)}
                    >
                      <Eye />
                    </button>
                  )}
                </div>
                {ins.map((label, i) => (
                  <div key={label} className="cnode__row" style={{ top: HEAD + 4 + ROW * i }}>
                    <span
                      className={`cnode__in${n.inputs[i] ? ' is-joined' : ''}${n.kind === 'merge' && i === 2 ? ' is-mask' : ''}`}
                      data-node={n.id}
                      data-in={i}
                      title={n.inputs[i] ? `${label}: drag to join elsewhere, or off to unjoin` : label}
                      onPointerDown={(e) => {
                        const from = n.inputs[i];
                        if (from) startLink(e, from, { to: n.id, input: i });
                        else e.stopPropagation();
                      }}
                    />
                    <span className="cnode__label">{label}</span>
                  </div>
                ))}
                {n.kind !== 'out' && (
                  <span
                    className="cnode__out"
                    style={{ top: HEAD + 4 + ROW / 2 - 5 }}
                    title="Output: drag to an input"
                    onPointerDown={(e) => startLink(e, n.id)}
                  />
                )}
                {(n.kind === 'in' || n.kind === 'under') && <span className="cnode__src">{n.kind === 'in' ? 'This clip' : 'The timeline'}</span>}
                {(n.kind === 'solid' || n.kind === 'gradient') && (
                  <span className="cnode__src">
                    {(n.kind === 'solid' ? [n.d?.color ?? '#1e2a38'] : [n.d?.color1 ?? '#1e3a5f', n.d?.color2 ?? '#d08a48']).map((c) => (
                      <i key={c} className="cnode__swatch" style={{ background: c }} />
                    ))}
                    {n.kind === 'solid' ? (n.d?.color ?? '#1e2a38').toUpperCase() : 'Two colors'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {menu && <PopMenu x={menu.x} y={menu.y} items={addMenu(add(menu.at))} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** The chosen node's settings, beside the viewer. */
export function NodeInspector({ doc, engine, actions, ui }: { doc: Doc; engine: Engine; actions: Actions; ui: Ui }) {
  useDoc(doc);
  const u = useUi(ui);
  const t = usePlayhead(engine);
  const clip = compositeClip(doc, t);
  const { fx, change, graph } = useComposite(doc, actions, clip);
  const g = useMemo(() => (fx ? graphOf(fx) : null), [fx]);
  const n = g?.nodes.find((x) => x.id === u.compNode);
  if (!clip || !fx || !g)
    return (
      <div className="insp nodeinsp">
        <h2 className="insp__title">
          <Layers /> Node settings
        </h2>
        <p className="insp__note">Start a node composite below, then choose a node to change it.</p>
      </div>
    );
  if (!n)
    return (
      <div className="insp nodeinsp">
        <h2 className="insp__title">
          <Layers /> Node settings
        </h2>
        <p className="insp__note">Choose a node in the graph to change it. Every number can be keyframed, as in Effect controls.</p>
        <label className="insp__row">
          <span className="field__label">Composite on</span>
          <input
            type="checkbox"
            checked={fx.on}
            onChange={(e) => change(e.target.checked ? 'Node composite on' : 'Node composite off', (x) => ({ ...x, on: e.target.checked }))}
          />
        </label>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => actions.update([clip.id], 'Remove node composite', (c) => ({ ...c, effects: c.effects.filter((e) => e.id !== fx.id) }))}
        >
          <Trash2 />
          Remove the composite
        </button>
      </div>
    );
  const local = Math.max(0, Math.min(clip.length - 1, t - clip.start));
  const seek = (f: number) => {
    engine.pause();
    engine.seek(f);
  };
  const setP = (key: string, v: Param, final: boolean) =>
    change(
      `${nodeName(n)}: ${nodeParams(n).find((x) => x.key === key)?.label ?? key}`,
      (e) => ({ ...e, p: { ...e.p, [paramKey(n.id, key)]: v } }),
      final ? undefined : `node-${n.id}-${key}`,
    );
  const colors: [string, string, string][] =
    n.kind === 'fx'
      ? Object.entries((effectDef(n.fx ?? '')?.data ?? {}) as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'string' && String(v).startsWith('#'))
          .map(([k, v]) => [k, k === 'color' ? 'Color' : k, String(v)])
      : (NODE_DEFS[n.kind].colors ?? []);
  return (
    <div className="insp nodeinsp">
      <h2 className="insp__title">
        <Layers /> {nodeName(n)}
      </h2>
      <p className="insp__note">{n.kind === 'fx' ? `${effectDef(n.fx ?? '')?.name ?? 'An effect'} on its input.` : NODE_DEFS[n.kind].about}</p>
      {n.kind !== 'out' && n.kind !== 'in' && n.kind !== 'under' && (
        <label className="insp__row">
          <span className="field__label">On</span>
          <input
            type="checkbox"
            checked={!n.off}
            aria-label="Node on"
            onChange={(e) => graph(e.target.checked ? 'Node on' : 'Bypass node', (gr) => ({ graph: updateNode(gr, n.id, { off: !e.target.checked }) }))}
          />
        </label>
      )}
      <label className="insp__row">
        <span className="field__label">Name</span>
        <input
          key={n.id}
          className="text text--sm"
          defaultValue={n.label ?? ''}
          placeholder={nodeName({ ...n, label: undefined })}
          aria-label="Node name"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          onBlur={(e) => {
            const label = e.target.value.trim();
            if (label !== (n.label ?? '')) graph('Name node', (gr) => ({ graph: updateNode(gr, n.id, label ? { label } : { label: undefined }) }));
          }}
        />
      </label>
      {colors.map(([key, label, fallback]) => (
        <div key={key} className="insp__row">
          <span className="field__label">{label}</span>
          <ColorField
            value={n.d?.[key] ?? fallback}
            label={label}
            onChange={(v) =>
              graph(`${nodeName(n)}: ${label}`, (gr) => ({ graph: updateNode(gr, n.id, { d: { ...(n.d ?? {}), [key]: v } }) }), `node-${n.id}-${key}`)
            }
          />
        </div>
      ))}
      <Section title="Settings">
        {nodeParams(n).length === 0 && <p className="insp__note">No settings.</p>}
        {nodeParams(n).map((pd) => {
          const value = fx.p[paramKey(n.id, pd.key)];
          if (pd.toggle || pd.options) {
            const v = typeof value === 'number' ? value : pd.def;
            return (
              <div key={pd.key} className="insp__row">
                <span className="field__label">{pd.label}</span>
                {pd.options ? (
                  pd.options.length <= 3 ? (
                    <Choice
                      value={Math.round(v)}
                      options={pd.options.map((o, i) => [i, o] as [number, string])}
                      onChange={(x) => setP(pd.key, x, true)}
                      label={pd.label}
                    />
                  ) : (
                    <select className="text text--sm" value={Math.round(v)} aria-label={pd.label} onChange={(e) => setP(pd.key, Number(e.target.value), true)}>
                      {pd.options.map((o, i) => (
                        <option key={o} value={i}>
                          {o}
                        </option>
                      ))}
                    </select>
                  )
                ) : (
                  <input type="checkbox" checked={v > 0.5} aria-label={pd.label} onChange={(e) => setP(pd.key, e.target.checked ? 1 : 0, true)} />
                )}
              </div>
            );
          }
          return (
            <ParamRow
              key={pd.key}
              label={pd.label}
              param={value}
              local={local}
              def={pd.def}
              min={pd.min}
              max={pd.max}
              step={pd.step}
              unit={pd.unit}
              clipStart={clip.start}
              onSeek={seek}
              keys={!pd.still}
              onChange={(p, final) => setP(pd.key, p, final)}
            />
          );
        })}
      </Section>
    </div>
  );
}
