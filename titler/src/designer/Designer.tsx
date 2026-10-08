// Lumora Titler's designer: the whole window. The same component runs in the
// web app, the desktop app, and the Titler windows of Lumora and Studio (the
// host gives files, the library and rendering; the look follows the app).

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Circle,
  Hand,
  MousePointer2,
  Pause,
  PenTool,
  Play,
  Redo2,
  SkipBack,
  Square,
  Type,
  Undo2,
  Film,
  FolderOpen,
  Save,
  Library,
  Download,
  Upload,
  Plus,
} from 'lucide-react';
import { browserEnv, requestFonts, type BrowserEnv } from '../core/browserEnv';
import { cloneLayers, newProject, newText } from '../core/build';
import { tokensFor } from '../core/binding';
import { fileName } from '../core/package';
import type { BrandTokens, Layer, TitleProject, Values } from '../core/types';
import { Inspector } from './Inspector';
import { CompositionPanel, DataPanel, FieldsPanel, LibraryPanel, LookPanel, ProjectPanel } from './Panels';
import { Timeline, toggleOpen } from './Timeline';
import { Viewport, lookOf } from './Viewport';
import { layerBounds } from './geometry';
import { addLayers, align, compOf, distribute, duplicate, findLayer, group, precompose, removeLayers, restack, ungroup, updateLayers, nudge } from './ops';
import { Store, useStore, type Tool } from './store';
import type { Host, VideoTarget } from './host';
import { download } from './host';
import { FORMAT_NAMES, renderVideo, wholeJob } from './renderVideo';
import { animatedProps, getProp, withProp } from './props';
import { isAnimated, setKey, valueAt } from '../core/easing';
import { Mark } from './Mark';
import './designer.css';

export type Look = 'ink' | 'lumora' | 'studio';

export interface DesignerProps {
  host: Host;
  /** The project to open (else the autosave, else a new one). */
  initial?: TitleProject | null;
  /** The window's look: the web/desktop app's own, Lumora's console, or Studio's. */
  look?: Look;
  /** The event look from Lumora or Studio (previewed instead of the template's own). */
  brand?: Partial<BrandTokens> | null;
  /** Values to preview with (Lumora's current field values). */
  values?: Values;
  /** Lumora / Studio: "Use in Lumora" / "Use in Studio" puts the title back where it was opened from. */
  onUse?: (p: TitleProject) => void;
  useLabel?: string;
  onClose?: () => void;
  /** For tests: an environment instead of the browser's. */
  env?: BrowserEnv;
}

const CLIP_MIME = 'application/x-lumora-titler-layers';
let clipboard: Layer[] | null = null;

export function Designer({ host, initial, look = 'ink', brand = null, values = {}, onUse, useLabel, onClose, env: givenEnv }: DesignerProps) {
  const env = useMemo(() => givenEnv ?? browserEnv(host.urlFor), [givenEnv, host]);
  const store = useMemo(() => new Store(initial ?? newProject(), { brand, values }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [side, setSide] = useState<'library' | 'project'>(initial ? 'project' : 'library');
  const [right, setRight] = useState<'layer' | 'comp' | 'fields' | 'look' | 'data'>('layer');
  const [renderOpen, setRenderOpen] = useState(false);
  const [recovered, setRecovered] = useState<TitleProject | null>(null);
  const [libId, setLibId] = useState<string | null>(null);
  const tool = useStore(store, (s) => s.tool);
  const playing = useStore(store, (s) => s.playing);
  const project = useStore(store, (s) => s.project);
  const dirty = useStore(store, (s) => s.dirty);
  const status = useStore(store, (s) => s.status);
  const cue = useStore(store, (s) => s.cue);
  const selection = useStore(store, (s) => s.selection);
  const show = useStore(store, (s) => s.show);
  const zoom = useStore(store, (s) => s.zoom);

  // Fonts the project uses, and its files.
  useEffect(() => {
    const t = tokensFor(project, brand ?? undefined);
    void requestFonts([t.font, t.fontSub]);
    void env.prepare(project);
  }, [project, env, brand]);

  // Crash recovery: offer the kept copy if it is not what was opened.
  useEffect(() => {
    if (initial) return;
    void host.recover().then((p) => p && p.compositions.length && setRecovered(p));
  }, [host, initial]);

  // Autosave a few seconds after each change.
  useEffect(() => {
    if (!dirty) return;
    const id = setTimeout(() => host.autosave(store.get().project), 1500);
    return () => clearTimeout(id);
  }, [project, dirty, host, store]);

  // Playback: time moves at the play rate, round the composition.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = store.get();
      const c = compOf(s.project, s.compId);
      let t = s.time + ((now - last) / 1000) * s.rate;
      last = now;
      if (t >= c.duration) t = 0;
      if (t < 0) t = c.duration - 1 / c.fps;
      store.set({ time: t });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, store]);

  // The take preview ends once the OUT has played.
  useEffect(() => {
    if (!cue || cue.outAt === null) return;
    const c = store.comp();
    const left = (c.duration - c.markers.outStart) * 1000 - (performance.now() - cue.outAt);
    const id = setTimeout(() => store.set({ cue: null, time: c.markers.inEnd }), Math.max(0, left) + 100);
    return () => clearTimeout(id);
  }, [cue, store]);

  const open = (p: TitleProject, id?: string | null, path?: string | null) => {
    if (store.get().dirty && !confirm('Open another title? Changes to this one that are not saved will be lost.')) return;
    store.load(p, { path: path ?? null });
    setLibId(id ?? null);
    setSide('project');
    host.autosave(null);
  };

  const saveToLibrary = async () => {
    try {
      const id = await host.saveLibrary(store.get().project, libId);
      setLibId(id);
      store.set({ dirty: false, status: `Saved to the library (${host.libraryName})`, path: store.get().path ?? id });
      host.autosave(null);
    } catch (e) {
      store.set({ status: e instanceof Error ? e.message : String(e) });
    }
  };

  const exportFile = async () => {
    const path = await host.saveFile(store.get().project, store.get().path);
    if (path) store.set({ dirty: false, status: `Saved ${path}`, path });
  };

  const openFile = async () => {
    const r = await host.openFile();
    if (!r) return;
    if (!r.result.project) {
      store.set({ status: r.result.error ?? 'It could not be opened.' });
      alert(r.result.error ?? 'It could not be opened.');
      return;
    }
    open(r.result.project, null, r.path);
    if (r.result.notes.length) store.set({ status: r.result.notes.join(' ') });
  };

  const boxOf = (l: Layer) => layerBounds(lookOf(store.get()), l);
  const cmd = useCommands(store, boxOf);

  // Keyboard shortcuts (like a motion-graphics app).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (!rootRef.current?.isConnected) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const s = store.get();
      const c = store.comp();
      const frame = 1 / c.fps;
      const handled = () => e.preventDefault();
      if (mod && k === 'z') return (handled(), e.shiftKey ? store.redo() : store.undo());
      if (mod && k === 'y') return (handled(), store.redo());
      if (mod && k === 's') return (handled(), void (e.shiftKey ? exportFile() : saveToLibrary()));
      if (mod && k === 'o') return (handled(), void openFile());
      if (mod && e.shiftKey && k === 'c') return (handled(), cmd.precompose());
      if (mod && k === 'c') return (handled(), cmd.copy());
      if (mod && k === 'x') return (handled(), cmd.cut());
      if (mod && k === 'v') return (handled(), cmd.paste());
      if (mod && k === 'd') return (handled(), cmd.duplicate());
      if (mod && k === 'a') return (handled(), store.set({ selection: c.layers.map((l) => l.id) }));
      if (mod && k === 'g') return (handled(), e.shiftKey ? cmd.ungroup() : cmd.group());
      if (mod && k === '0') return (handled(), store.set({ zoom: 0, pan: [0, 0] }));
      if (mod && (k === '=' || k === '+')) return (handled(), store.set((x) => ({ zoom: Math.min(8, (x.zoom || 0.5) * 1.25) })));
      if (mod && k === '-') return (handled(), store.set((x) => ({ zoom: Math.max(0.05, (x.zoom || 0.5) / 1.25) })));
      if (mod && k === ']') return (handled(), cmd.restack(e.shiftKey ? 'front' : 'forward'));
      if (mod && k === '[') return (handled(), cmd.restack(e.shiftKey ? 'back' : 'backward'));
      if (mod) return;
      switch (e.key) {
        case ' ':
          handled();
          store.set((x) => ({ playing: !x.playing, rate: 1, cue: null }));
          return;
        case 'Delete':
        case 'Backspace':
          handled();
          cmd.remove();
          return;
        case 'Home':
          handled();
          store.set({ time: 0, cue: null });
          return;
        case 'End':
          handled();
          store.set({ time: c.duration - frame, cue: null });
          return;
        case 'PageDown':
          handled();
          store.set((x) => ({ time: Math.min(c.duration, x.time + frame), cue: null }));
          return;
        case 'PageUp':
          handled();
          store.set((x) => ({ time: Math.max(0, x.time - frame), cue: null }));
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!s.selection.length) {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
              store.set((x) => ({ time: Math.min(c.duration, Math.max(0, x.time + (e.key === 'ArrowRight' ? frame : -frame) * (e.shiftKey ? 10 : 1))) }));
            handled();
            return;
          }
          handled();
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          store.edit('Nudge', (p) => updateLayers(p, c.id, s.selection, (l) => nudge(l, dx, dy, s.time)));
          return;
        }
        case 'Escape':
          store.set({ selection: [], keys: [], tool: 'select' });
          return;
        case '[':
        case ']': {
          // Move the layer so it starts ([) or ends (]) at the playhead.
          handled();
          store.edit('Move layer to playhead', (p) =>
            updateLayers(p, c.id, s.selection, (l) => {
              const len = l.end - l.start;
              const start = e.key === '[' ? s.time : s.time - len;
              return { ...l, start: Math.max(0, start), end: Math.max(0, start) + len };
            }),
          );
          return;
        }
      }
      switch (k) {
        case 'v':
          return store.set({ tool: 'select' });
        case 't':
          return store.set({ tool: 'text' });
        case 'r':
        case 'q':
          return store.set({ tool: e.shiftKey ? 'ellipse' : 'rect' });
        case 'e':
          return store.set({ tool: 'ellipse' });
        case 'g':
          return store.set({ tool: 'pen' });
        case 'h':
          return store.set({ tool: 'hand' });
        case 'j':
          return store.set((x) => ({ playing: true, rate: x.playing && x.rate < 0 ? Math.max(-8, x.rate * 2) : -1, cue: null }));
        case 'k':
          return store.set({ playing: false, rate: 1 });
        case 'l':
          return store.set((x) => ({ playing: true, rate: x.playing && x.rate > 0 ? Math.min(8, x.rate * 2) : 1, cue: null }));
        case 'i':
        case 'o': {
          // To the selected layer's start or end, or to the IN / OUT markers.
          const l = s.selection[0] ? findLayer(c, s.selection[0]) : undefined;
          const t = l ? (k === 'i' ? l.start : l.end - frame) : k === 'i' ? c.markers.inEnd : c.markers.outStart;
          return store.set({ time: Math.max(0, t), cue: null });
        }
        case 'u': {
          // Show the selected layers' animated properties (or all layers' when none is selected).
          const ids = s.selection.length ? s.selection : c.layers.filter((l) => animatedProps(l).length).map((l) => l.id);
          let next = s.open;
          for (const id of ids) next = toggleOpen(next, id, 'animated');
          return store.set({ open: next });
        }
        case 'p':
        case 's':
        case 'a': {
          const path = k === 'p' ? 'transform.position' : k === 's' ? 'transform.scale' : 'transform.anchor';
          if (e.altKey) {
            // Alt+P/S: a keyframe of that property at the playhead.
            store.edit('Add keyframe', (p) => updateLayers(p, c.id, s.selection, (l) => withProp(l, path, keyHere(getProp(l, path), s.time))));
          }
          return;
        }
        case 'n':
          return cmd.addText();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, cmd]);

  // Unsaved changes: ask before the page closes.
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (store.get().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [store]);

  const rootRef = useRef<HTMLDivElement>(null);
  const c = compOf(project, store.get().compId);
  const tools: [Tool, string, React.ReactNode, string][] = [
    ['select', 'Select', <MousePointer2 key="s" size={16} />, 'V'],
    ['text', 'Text', <Type key="t" size={16} />, 'T'],
    ['rect', 'Rectangle', <Square key="r" size={16} />, 'R'],
    ['ellipse', 'Ellipse', <Circle key="e" size={16} />, 'E'],
    ['pen', 'Pen (paths)', <PenTool key="p" size={16} />, 'G'],
    ['hand', 'Hand (move the view)', <Hand key="h" size={16} />, 'H'],
  ];
  return (
    <div className={`tt tt-look-${look}`} ref={rootRef} data-testid="titler-designer">
      <header className="tt-top">
        <span className="tt-brand">
          <Mark size={18} />
          <span>Titler</span>
        </span>
        <div className="tt-menu">
          <button onClick={() => open(newProject(), null)} title="New title">
            <Plus size={15} /> New
          </button>
          <button onClick={() => void openFile()} title="Open a .lumtitle file (Ctrl+O)">
            <FolderOpen size={15} /> Open
          </button>
          <button onClick={() => void saveToLibrary()} title={`Save to the library: ${host.libraryName} (Ctrl+S)`}>
            <Save size={15} /> Save
          </button>
          <button onClick={() => void exportFile()} title="Save as a .lumtitle file with its pictures and fonts inside (Ctrl+Shift+S)">
            <Download size={15} /> Export .lumtitle
          </button>
          <button onClick={() => setRenderOpen(true)} title="Render to a film or PNG sequence">
            <Film size={15} /> Render
          </button>
        </div>
        <div className="tt-sep" />
        <div className="tt-tools" role="toolbar" aria-label="Tools">
          {tools.map(([id, name, icon, key]) => (
            <button
              key={id}
              className={tool === id ? 'on' : ''}
              onClick={() => store.set({ tool: id })}
              title={`${name} (${key})`}
              aria-label={name}
              aria-pressed={tool === id}
            >
              {icon}
            </button>
          ))}
        </div>
        <div className="tt-sep" />
        <div className="tt-tools" role="toolbar" aria-label="Align">
          {(
            [
              ['left', <AlignStartVertical key="l" size={15} />, 'Align left edges'],
              ['hcenter', <AlignCenterVertical key="hc" size={15} />, 'Align centers across'],
              ['right', <AlignEndVertical key="r" size={15} />, 'Align right edges'],
              ['top', <AlignStartHorizontal key="t" size={15} />, 'Align top edges'],
              ['vcenter', <AlignCenterHorizontal key="vc" size={15} />, 'Align middles'],
              ['bottom', <AlignEndHorizontal key="b" size={15} />, 'Align bottom edges'],
            ] as const
          ).map(([how, icon, name]) => (
            <button
              key={how}
              disabled={!selection.length}
              onClick={() => store.edit(name, (p) => align(p, store.get().compId, store.get().selection, how, store.get().time, boxOf))}
              title={`${name} (one layer: to the frame)`}
              aria-label={name}
            >
              {icon}
            </button>
          ))}
          <button
            disabled={selection.length < 3}
            onClick={() => store.edit('Distribute across', (p) => distribute(p, store.get().compId, store.get().selection, 'x', store.get().time, boxOf))}
            title="Spread evenly across"
            aria-label="Distribute across"
          >
            ⇹
          </button>
          <button
            disabled={selection.length < 3}
            onClick={() => store.edit('Distribute down', (p) => distribute(p, store.get().compId, store.get().selection, 'y', store.get().time, boxOf))}
            title="Spread evenly down"
            aria-label="Distribute down"
          >
            ⇵
          </button>
        </div>
        <div className="tt-sep" />
        <div className="tt-tools">
          <button onClick={() => store.undo()} disabled={!store.canUndo()} title={`Undo ${store.undoLabel().toLowerCase()} (Ctrl+Z)`} aria-label="Undo">
            <Undo2 size={15} />
          </button>
          <button onClick={() => store.redo()} disabled={!store.canRedo()} title={`Redo ${store.redoLabel().toLowerCase()} (Ctrl+Shift+Z)`} aria-label="Redo">
            <Redo2 size={15} />
          </button>
        </div>
        <span className="tt-grow" />
        <span className="tt-title" title={store.get().path ?? ''}>
          {project.name}
          {dirty ? ' •' : ''}
        </span>
        {onUse && (
          <button className="tt-primary" onClick={() => onUse(store.get().project)}>
            {useLabel ?? 'Use this title'}
          </button>
        )}
        {onClose && (
          <button className="tt-plain" onClick={onClose}>
            Close
          </button>
        )}
      </header>
      {recovered && (
        <div className="tt-banner" role="status">
          A title that was not saved ({recovered.name}) was kept when the app last closed.
          <button
            onClick={() => {
              store.load(recovered);
              store.set({ dirty: true });
              setRecovered(null);
              setSide('project');
            }}
          >
            Open it
          </button>
          <button
            onClick={() => {
              host.autosave(null);
              setRecovered(null);
            }}
          >
            Discard it
          </button>
        </div>
      )}
      <div className="tt-main">
        <aside className="tt-left">
          <div className="tt-tabs">
            <button className={side === 'library' ? 'on' : ''} onClick={() => setSide('library')}>
              <Library size={13} /> Library
            </button>
            <button className={side === 'project' ? 'on' : ''} onClick={() => setSide('project')}>
              <Upload size={13} /> Project
            </button>
          </div>
          {side === 'library' ? (
            <LibraryPanel store={store} host={host} env={env} onOpen={(p, id) => open(p, id)} />
          ) : (
            <ProjectPanel store={store} host={host} />
          )}
        </aside>
        <section className="tt-center">
          <div className="tt-viewbar">
            <input
              className="tt-projname"
              value={project.name}
              aria-label="Title name"
              onChange={(e) => store.edit('Rename title', (p) => ({ ...p, name: e.target.value }))}
            />
            <select
              className="tt-select"
              aria-label="Category"
              value={project.category}
              onChange={(e) => store.edit('Category', (p) => ({ ...p, category: e.target.value }))}
            >
              {['Lower thirds', 'Bugs', 'Tickers and banners', 'Scoreboards', 'Full screen', 'Cards', 'Custom'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <span className="tt-grow" />
            {(
              [
                ['safe', 'Safe areas'],
                ['guides', 'Guides'],
                ['grid', 'Grid'],
                ['rulers', 'Rulers'],
                ['snap', 'Snapping'],
                ['motionPaths', 'Motion paths'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="tt-check">
                <input type="checkbox" checked={show[k]} onChange={(e) => store.set((x) => ({ show: { ...x.show, [k]: e.target.checked } }))} />
                {label}
              </label>
            ))}
            <select className="tt-select" aria-label="Zoom" value={zoom} onChange={(e) => store.set({ zoom: Number(e.target.value), pan: [0, 0] })}>
              <option value={0}>Fit</option>
              {[0.25, 0.5, 0.75, 1, 1.5, 2].map((z) => (
                <option key={z} value={z}>
                  {Math.round(z * 100)}%
                </option>
              ))}
              {zoom > 0 && ![0.25, 0.5, 0.75, 1, 1.5, 2].includes(zoom) && <option value={zoom}>{Math.round(zoom * 100)}%</option>}
            </select>
          </div>
          <Viewport store={store} env={env} />
          <div className="tt-transport">
            <button onClick={() => store.set({ time: 0, cue: null, playing: false })} aria-label="Go to start" title="Start (Home)">
              <SkipBack size={15} />
            </button>
            <button
              onClick={() => store.set((x) => ({ playing: !x.playing, rate: 1, cue: null }))}
              aria-label={playing ? 'Pause' : 'Play'}
              title="Play / pause (Space); J, K, L for reverse, stop, forward"
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <span className="tt-sep" />
            <span className="tt-dim">Preview as on air:</span>
            <button
              className={cue && cue.outAt === null ? 'on' : ''}
              onClick={() => store.set({ cue: { inAt: performance.now(), outAt: null }, playing: false })}
              title="Play the IN, then hold (and loop)"
            >
              Take IN
            </button>
            <button
              disabled={!cue || cue.outAt !== null}
              onClick={() => store.set((x) => ({ cue: x.cue ? { ...x.cue, outAt: performance.now() } : null }))}
              title="Play the OUT"
            >
              Take OUT
            </button>
            <span className="tt-grow" />
            <span className="tt-dim">
              {c.width} × {c.height} · {c.fps} fps
            </span>
          </div>
        </section>
        <aside className="tt-right">
          <div className="tt-tabs">
            {(
              [
                ['layer', 'Layer'],
                ['comp', 'Composition'],
                ['fields', 'Fields'],
                ['look', 'Look'],
                ['data', 'Data'],
              ] as const
            ).map(([id, name]) => (
              <button key={id} className={right === id ? 'on' : ''} onClick={() => setRight(id)}>
                {name}
              </button>
            ))}
          </div>
          <div className="tt-right-body">
            {right === 'layer' && <Inspector store={store} />}
            {right === 'comp' && <CompositionPanel store={store} />}
            {right === 'fields' && <FieldsPanel store={store} host={host} />}
            {right === 'look' && <LookPanel store={store} host={host} />}
            {right === 'data' && <DataPanel store={store} />}
          </div>
        </aside>
      </div>
      <Timeline store={store} />
      <footer className="tt-status" role="status">
        {status || 'Ready.'}
      </footer>
      {renderOpen && <RenderDialog store={store} host={host} env={env} onClose={() => setRenderOpen(false)} />}
    </div>
  );
}

/** A keyframe at t with the value there (the property starts animating if it was still). */
function keyHere(p: ReturnType<typeof getProp>, t: number) {
  if (!p) return p as never;
  if (!isAnimated(p)) return { k: [{ t, v: p.v }] } as never;
  return setKey(p as never, t, valueAt(p as never, t, p.k[0]!.v as never)) as never;
}

/** The layer commands (shared by the keyboard and the menus). */
function useCommands(store: Store, boxOf: (l: Layer) => ReturnType<typeof layerBounds>) {
  return useMemo(() => {
    const sel = () => store.get().selection;
    const compId = () => store.get().compId;
    return {
      copy() {
        const layers = store.selected();
        if (!layers.length) return;
        clipboard = cloneLayers(layers);
        try {
          void navigator.clipboard?.writeText(JSON.stringify({ type: CLIP_MIME, layers }));
        } catch {
          /* the app's own clipboard still has them */
        }
        store.set({ status: `Copied ${layers.length} layer${layers.length > 1 ? 's' : ''}` });
      },
      cut() {
        this.copy();
        this.remove();
      },
      async paste() {
        let layers = clipboard;
        try {
          const text = await navigator.clipboard?.readText();
          const o = text ? (JSON.parse(text) as { type?: string; layers?: Layer[] }) : null;
          if (o?.type === CLIP_MIME && Array.isArray(o.layers)) layers = o.layers;
        } catch {
          /* not ours */
        }
        if (!layers?.length) return;
        const copies = cloneLayers(layers);
        store.edit('Paste', (p) => addLayers(p, compId(), copies, sel()[0] ?? null), {
          selection: copies.map((l) => l.id),
          status: `Pasted ${copies.length} layer${copies.length > 1 ? 's' : ''}`,
        });
      },
      duplicate() {
        if (!sel().length) return;
        const r = duplicate(store.get().project, compId(), sel());
        store.edit('Duplicate', () => r.project, { selection: r.ids });
      },
      remove() {
        const s = store.get();
        if (s.keys.length) {
          // Keyframes selected: delete those.
          store.edit(
            'Delete keyframes',
            (p) => {
              let next = p;
              for (const r of s.keys)
                next = updateLayers(next, s.compId, [r.layer], (l) => {
                  const prop = getProp(l, r.path);
                  if (!isAnimated(prop)) return l;
                  const k = prop.k.filter((x) => Math.abs(x.t - r.t) > 1e-6);
                  return withProp(l, r.path, k.length ? { k } : { v: prop.k[0]!.v });
                });
              return next;
            },
            { keys: [] },
          );
          return;
        }
        if (!s.selection.length) return;
        store.edit('Delete', (p) => removeLayers(p, s.compId, s.selection), { selection: [] });
      },
      group() {
        if (sel().length < 1) return;
        const r = group(store.get().project, compId(), sel());
        if (r.id) store.edit('Group', () => r.project, { selection: [r.id] });
      },
      ungroup() {
        const l = store.selected()[0];
        if (l?.type !== 'group') return;
        store.edit('Ungroup', (p) => ungroup(p, compId(), l.id), { selection: l.children.map((k) => k.id) });
      },
      precompose() {
        if (!sel().length) return;
        const r = precompose(store.get().project, compId(), sel());
        if (r.id)
          store.edit('Precompose', () => r.project, {
            selection: [r.id],
            status: 'The layers are now in their own composition (double-click it in Project to open).',
          });
      },
      restack(how: 'forward' | 'backward' | 'front' | 'back') {
        if (!sel().length) return;
        store.edit('Change order', (p) => restack(p, compId(), sel(), how));
      },
      addText() {
        const c = store.comp();
        const l = newText(c, 'Text', [Math.round(c.width * 0.1), Math.round(c.height * 0.75)]);
        store.edit('Add text', (p) => addLayers(p, c.id, [l], sel()[0] ?? null), { selection: [l.id], editingText: l.id });
      },
      boxOf,
    };
  }, [store, boxOf]);
}

function RenderDialog({ store, host, env, onClose }: { store: Store; host: Host; env: BrowserEnv; onClose: () => void }) {
  const s = store.get();
  const c = store.comp();
  const [format, setFormat] = useState<VideoTarget['format']>(host.renderFormats[0] ?? 'webm-alpha');
  const [scale, setScale] = useState(1);
  const [range, setRange] = useState<'all' | 'in' | 'out'>('all');
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const run = async () => {
    setError('');
    const job = wholeJob(s.project, c.id, env, s.values, s.brand ?? undefined, scale);
    if (range === 'in') job.to = c.markers.outStart;
    if (range === 'out') job.from = c.markers.outStart;
    const name = fileName(s.project).replace(/\.lumtitle$/, '');
    abort.current = new AbortController();
    try {
      const out = await renderVideo(job, { name, format }, host, (d, t) => setProgress([d, t]), abort.current.signal);
      if (typeof out === 'string') store.set({ status: `Rendered ${out}` });
      else download(`${name}.${format === 'png-sequence' ? 'zip' : format === 'mp4' ? 'mp4' : format === 'prores4444' ? 'mov' : 'webm'}`, out);
      onClose();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  };
  const formats: VideoTarget['format'][] = ['prores4444', 'webm-alpha', 'mp4', 'png-sequence'];
  return (
    <div className="tt-modal" role="dialog" aria-label="Render">
      <div className="tt-modal-box">
        <h2>Render</h2>
        <p className="tt-dim">Every frame is drawn exactly, with see-through where there is no graphic (except MP4).</p>
        <label className="tt-field">
          <span className="tt-field-label">Format</span>
          <select className="tt-select" value={format} onChange={(e) => setFormat(e.target.value as VideoTarget['format'])}>
            {formats.map((f) => (
              <option key={f} value={f} disabled={!host.renderFormats.includes(f)}>
                {FORMAT_NAMES[f]}
                {host.renderFormats.includes(f) ? '' : ' (desktop app)'}
              </option>
            ))}
          </select>
        </label>
        <label className="tt-field">
          <span className="tt-field-label">Part</span>
          <select className="tt-select" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
            <option value="all">All of it: IN, HOLD and OUT ({c.duration.toFixed(1)} s)</option>
            <option value="in">IN and HOLD (to put on air, then cut)</option>
            <option value="out">OUT only</option>
          </select>
        </label>
        <label className="tt-field">
          <span className="tt-field-label">Size</span>
          <select className="tt-select" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
            <option value={1}>
              Full ({c.width} × {c.height})
            </option>
            <option value={0.5}>
              Half ({Math.round(c.width / 2)} × {Math.round(c.height / 2)})
            </option>
          </select>
        </label>
        {progress && (
          <div className="tt-progress" aria-label="Progress">
            <div style={{ width: `${(progress[0] / progress[1]) * 100}%` }} />
            <span>
              Frame {progress[0]} of {progress[1]}
            </span>
          </div>
        )}
        {error && <div className="tt-error">{error}</div>}
        <div className="tt-modal-actions">
          {progress ? (
            <button className="tt-plain" onClick={() => abort.current?.abort()}>
              Stop
            </button>
          ) : (
            <>
              <button className="tt-plain" onClick={onClose}>
                Cancel
              </button>
              <button className="tt-primary" onClick={() => void run()} disabled={!host.renderFormats.includes(format)}>
                Render
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
