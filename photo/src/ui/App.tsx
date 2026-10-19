// Lumora Photo's window: menus, options bar, toolbar, document tabs, the
// canvas, the dock, the status bar, and the start screen when nothing is open.

import { useEffect, useState } from 'react';
import { X, Sun, Moon } from 'lucide-react';
import { app, useApp, setCurrent, current, toast, requestFrame, setTool } from '../app/state';
import { handleShortcut } from '../app/commands';
import { toolFor } from '../app/tools';
import { MenuBar } from './MenuBar';
import { OptionsBar } from './OptionsBar';
import { Toolbox } from './Toolbox';
import { CanvasArea, held, onPointerInfo, pointerInfo } from './CanvasArea';
import { Dock } from './Dock';
import { StartScreen } from './StartScreen';
import { Dialogs } from './dialogs/Dialogs';
import { Workspaces } from './workspaces/Workspaces';
import { closeDoc, registerCommands } from './registerCommands';
import { zoomLabel } from '../app/viewMath';
import { openPicked } from '../app/files';
import { toolDef, TOOL_GROUPS } from '../app/toolDefs';
import { NumberField } from './fields';
import { actualPixels } from '../app/tools/viewTools';
import { viewport } from '../app/tools/types';
import './photo.css';

registerCommands();

// For the end-to-end checks (e2e/photo-smoke.mjs): a few handles on ?debug.
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug'))
  void Promise.all([
    import('../app/ops/common'),
    import('../core/composite'),
    import('../app/commands'),
    import('../app/files'),
    import('../core/io/psd'),
    import('../core/layers'),
    import('../core/io/lumphoto'),
  ]).then(([common, comp, cmds, files, psd, layers, lp]) => {
    (window as unknown as Record<string, unknown>).__photo = {
      app,
      current,
      flatten: common.flatten,
      compositeRect: comp.compositeRect,
      run: cmds.run,
      openPicked: files.openPicked,
      writePSD: psd.writePSD,
      allLayers: layers.allLayers,
      writeLumphoto: lp.writeLumphoto,
      readLumphoto: lp.readLumphoto,
      setTool,
      tools: TOOL_GROUPS.flat()
        .filter((t) => !t.hidden)
        .map((t) => t.id),
    };
  });

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function DocTabs() {
  const sessions = useApp((s) => s.sessions);
  const cur = useApp((s) => s.current);
  useApp((s) => s.rev);
  return (
    <div className="lp-tabs" role="tablist" aria-label="Documents">
      {sessions.map((s) => {
        const l = s.activeLayer();
        return (
          <div
            key={s.id}
            className="lp-tab"
            role="tab"
            aria-selected={s.id === cur}
            onClick={() => setCurrent(s.id)}
            onAuxClick={(e) => e.button === 1 && void closeDoc(s.id)}
            title={s.path ?? s.doc.name}
          >
            <span className="lp-tab-name">
              {s.doc.name} @ {zoomLabel(s.view.zoom)} ({l ? `${l.name}, ` : ''}RGB/{s.doc.depth}){s.unsaved ? ' *' : ''}
            </span>
            <button
              className="lp-icon-btn"
              aria-label={`Close ${s.doc.name}`}
              title="Close (Ctrl+W)"
              onClick={(e) => {
                e.stopPropagation();
                void closeDoc(s.id);
              }}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function StatusBar() {
  useApp((s) => s.rev);
  const tool = useApp((s) => s.tool);
  const [, setTick] = useState(0);
  useEffect(() => onPointerInfo(() => setTick((t) => t + 1)), []);
  const s = current();
  if (!s) return <div className="lp-status" />;
  return (
    <div className="lp-status">
      <NumberField
        value={Math.round(s.view.zoom * 1000) / 10}
        min={1}
        max={6400}
        digits={s.view.zoom < 0.1 ? 2 : 1}
        suffix="%"
        width={58}
        title="Zoom"
        onChange={(v) => actualPixels(v / 100)}
      />
      <span>
        {s.doc.width} × {s.doc.height} px ({Math.round(s.doc.resolution)} ppi)
      </span>
      <span>
        RGB/{s.doc.depth} · {s.doc.profile.name}
      </span>
      {pointerInfo.inside && (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          X {Math.floor(pointerInfo.x)} Y {Math.floor(pointerInfo.y)}
        </span>
      )}
      <span className="lp-grow" />
      <span>{toolDef(tool).name}</span>
    </div>
  );
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="lp-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`lp-toast${t.kind === 'error' ? ' lp-error' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Busy() {
  const busy = useApp((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="lp-busy" role="alert" aria-busy="true">
      <div className="lp-busy-box">
        <div>{busy.text}</div>
        <div className={`lp-progress${busy.progress === null ? ' lp-indeterminate' : ''}`}>
          <div style={busy.progress === null ? undefined : { width: `${Math.round(busy.progress * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

export function App() {
  const theme = useApp((s) => s.theme);
  const has = useApp((s) => s.sessions.length > 0);
  const screen = useApp((s) => s.screenMode);
  const workspace = useApp((s) => s.workspace);
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const st = app.get();
      if (st.dialog || st.workspace) return;
      if (e.key === ' ' && !e.repeat) {
        held.space = true;
        e.preventDefault();
        if (viewport.el) viewport.el.style.cursor = 'grab';
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        return;
      }
      held.alt = e.altKey;
      held.ctrl = e.ctrlKey || e.metaKey;
      held.shift = e.shiftKey;
      const t = toolFor(st.tool);
      try {
        if (t?.key?.(e)) {
          e.preventDefault();
          requestFrame();
          return;
        }
      } catch (err) {
        console.error(err);
      }
      if (handleShortcut(e)) return;
      // Browser shortcuts that would leave the page or zoom it.
      if ((e.ctrlKey || e.metaKey) && ['s', 'o', 'n', 'p', 'w', '=', '-', '0'].includes(e.key.toLowerCase())) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        held.space = false;
        requestFrame();
      }
      held.alt = e.altKey;
      held.ctrl = e.ctrlKey || e.metaKey;
      held.shift = e.shiftKey;
    };
    const blur = () => {
      held.space = held.alt = held.ctrl = held.shift = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    const leave = (e: BeforeUnloadEvent) => {
      if (app.get().sessions.some((s) => s.unsaved)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      window.removeEventListener('beforeunload', leave);
    };
  }, []);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    const picked = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    if (current() && !e.shiftKey) {
      const { placeBytes } = await import('../app/place');
      for (const p of picked) {
        try {
          if (/\.(lumphoto|psd|psb)$/i.test(p.name)) await openPicked([p]);
          else await placeBytes(p.name, p.bytes);
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), 'error');
        }
      }
    } else await openPicked(picked);
  };

  return (
    <div
      className="lp"
      data-theme={theme}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget || !(e.relatedTarget instanceof Node)) setDropping(false);
      }}
      onDrop={(e) => void onDrop(e)}
    >
      <MenuBar
        right={
          <button
            className="lp-icon-btn"
            title={theme === 'dark' ? 'Light interface' : 'Dark interface'}
            aria-label="Switch interface theme"
            onClick={() => app.set({ theme: theme === 'dark' ? 'light' : 'dark' })}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        }
      />
      <div style={{ display: has ? 'contents' : 'none' }}>{screen !== 'full' && <OptionsBar />}</div>
      <div className="lp-main" style={{ display: has ? undefined : 'none' }}>
        {screen !== 'full' && <Toolbox />}
        <div className="lp-center">
          {screen !== 'full' && <DocTabs />}
          <CanvasArea />
          {screen !== 'full' && <StatusBar />}
        </div>
        {screen !== 'full' && <Dock />}
      </div>
      {!has && <StartScreen />}
      {workspace && <Workspaces />}
      <Dialogs />
      <Busy />
      <Toasts />
      {dropping && (
        <div className="lp-drop">
          <div>{current() ? 'Drop to place in the document (Shift: open separately)' : 'Drop to open'}</div>
        </div>
      )}
    </div>
  );
}
