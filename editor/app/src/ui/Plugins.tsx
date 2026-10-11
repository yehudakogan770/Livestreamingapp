// VST3 effects on sound clips: choosing one of the plug-ins installed on the
// computer, and its parameters in Effect controls. Plug-ins are opened in a
// helper process; their settings are the plug-in's own saved state.
import { RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { pluginOf, type FoundPlugin, type PluginData, type PluginParam } from '../model/plugins';
import { current, rate } from '../model/seq';
import type { Clip, Effect, Project } from '../model/types';
import { inApp, native } from '../native';
import { onPluginSound, pluginProblem, pluginSound } from '../player/plugins';
import { Modal } from './controls';
import './plugins.css';

type Scan = Awaited<ReturnType<typeof native.vstScan>>;

/** Plug-in windows open on Windows (elsewhere the parameters are here). */
const onWindows = (): boolean => inApp() && typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
let scanned: Promise<Scan> | null = null;

/** The plug-ins on the computer (looked for once a session, or again when asked). */
function scanPlugins(again = false): Promise<Scan> {
  if (!scanned || again) scanned = native.vstScan(again);
  return scanned;
}

/** Choose a VST3 effect installed on the computer. */
export function PluginPicker({ onPick, onClose }: { onPick: (p: FoundPlugin) => void; onClose: () => void }) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [problem, setProblem] = useState('');
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  const look = (again: boolean) => {
    setBusy(true);
    setProblem('');
    scanPlugins(again)
      .then(setScan)
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    if (inApp()) look(false);
  }, []);
  const q = find.trim().toLowerCase();
  const list = useMemo(() => (scan?.effects ?? []).filter((p) => !q || `${p.name} ${p.vendor} ${p.subCategories}`.toLowerCase().includes(q)), [scan, q]);
  const kind = (p: FoundPlugin) =>
    p.subCategories
      .split('|')
      .filter((x) => x && x !== 'Fx' && x !== 'Stereo' && x !== 'Mono')
      .join(' · ');
  return (
    <Modal title="VST3 plug-ins" onClose={onClose} wide>
      <div className="form plugpick">
        {!inApp() ? (
          <p className="insp__note">VST3 plug-ins are used in the installed program.</p>
        ) : (
          <>
            <div className="plugpick__bar">
              <Search />
              <input
                className="text"
                type="search"
                autoFocus
                placeholder="Find a plug-in or a company"
                aria-label="Find a plug-in"
                value={find}
                onChange={(e) => setFind(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button type="button" className="btn btn--sm" disabled={busy} title="Look in the plug-in folders again" onClick={() => look(true)}>
                <RefreshCw />
                Look again
              </button>
            </div>
            {busy && <p className="insp__note">Looking at the plug-ins on this computer (each is opened safely, once)…</p>}
            {problem && <p className="form__problem">{problem}</p>}
            {scan && (
              <ul className="smart__list plugpick__list" role="listbox" aria-label="Plug-ins">
                {list.length === 0 && (
                  <li className="smart__empty">
                    {scan.effects.length ? 'None match.' : `No VST3 effects were found. Lumora Studio looks in ${scan.folders.join(' and ')}.`}
                  </li>
                )}
                {list.map((p) => (
                  <li key={`${p.path}|${p.cid}`}>
                    <button type="button" className="plugpick__item" role="option" aria-selected={false} onClick={() => onPick(p)}>
                      <b>{p.name}</b>
                      <span>{p.vendor}</span>
                      {kind(p) && <i>{kind(p)}</i>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {scan && scan.broken.length > 0 && (
              <details className="plugpick__broken">
                <summary>
                  {scan.broken.length} plug-in file{scan.broken.length === 1 ? '' : 's'} could not be used
                </summary>
                <ul>
                  {scan.broken.map((b) => (
                    <li key={b.path} title={b.path}>
                      {b.path.split(/[\\/]/).pop()}: {b.problem}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="insp__note">
              Effects run on the clip’s sound first, before its other effects. The plug-in works in the background; until it is done the clip plays without it.
            </p>
          </>
        )}
        <div className="form__foot">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** A plug-in effect's controls (inside its Effect controls section). */
export function PluginControls({
  project,
  clip,
  effect,
  onChange,
}: {
  project: Project;
  clip: Clip;
  effect: Effect;
  onChange: (d: PluginData, label: string) => void;
}) {
  const d = pluginOf(effect);
  const [problem, setProblem] = useState('');
  const [dragging, setDragging] = useState<{ id: number; value: number } | null>(null);
  const [windowOpen, setWindowOpen] = useState(false);
  const [, redraw] = useState(0);
  useEffect(() => onPluginSound(() => redraw((n) => n + 1)), []);
  // The first time: read its parameters (and its own default settings).
  useEffect(() => {
    if (!d || d.params.length || !inApp()) return;
    native
      .vstSettings(d.path, d.cid, d.state || null)
      .then((r) => onChange({ ...d, params: r.params, state: d.state || r.state }, 'Read plug-in settings'))
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
    // Only when another plug-in is shown.
  }, [d?.path, d?.cid]);
  if (!d) return <p className="form__problem">This plug-in effect is damaged.</p>;
  const set = (p: PluginParam, value: number) => {
    setProblem('');
    native
      .vstSettings(d.path, d.cid, d.state || null, [[p.id, value]])
      .then((r) => onChange({ ...d, params: r.params, state: r.state }, `${d.name}: ${p.title}`))
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => setDragging(null));
  };
  const openWindow = () => {
    setProblem('');
    setWindowOpen(true);
    native
      .vstEdit(d.path, d.cid, d.state || null, `${d.name} — ${clip.name}`)
      .then((r) => onChange({ ...d, params: r.params, state: r.state }, `${d.name} settings`))
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => setWindowOpen(false));
  };
  const m = project.media.find((x) => clip.source.kind === 'media' && x.id === clip.source.media);
  const fps = rate(current(project));
  const failed = m ? pluginProblem(clip, m, fps) : null;
  const ready = m && effect.on ? !!pluginSound(clip, m, fps) : false;
  return (
    <div className="plugctl">
      <p className="insp__note">
        {d.vendor ? `${d.vendor} · ` : ''}
        {!effect.on ? 'Off' : failed ? 'Could not run' : ready ? 'Ready: playing through the plug-in' : 'Working in the background…'}
      </p>
      {(problem || failed) && <p className="form__problem">{problem || failed}</p>}
      {onWindows() && (
        <button type="button" className="btn btn--sm" disabled={windowOpen} title="The plug-in's own controls, in a window of their own" onClick={openWindow}>
          {windowOpen ? 'The plug-in window is open: close it to come back' : 'Open the plug-in window'}
        </button>
      )}
      {d.params.length === 0 && !problem && <p className="insp__note">Reading its settings…</p>}
      {d.params.map((p) => {
        const value = dragging?.id === p.id ? dragging.value : p.value;
        if (p.steps === 1)
          return (
            <label key={p.id} className="insp__row">
              <span className="field__label">{p.title}</span>
              <input type="checkbox" checked={value >= 0.5} onChange={(e) => set(p, e.target.checked ? 1 : 0)} />
            </label>
          );
        return (
          <div key={p.id} className="insp__row plugctl__row">
            <span className="field__label" title={p.title}>
              {p.title}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={p.steps > 1 ? 1 / p.steps : 0.001}
              value={value}
              aria-label={p.title}
              onChange={(e) => setDragging({ id: p.id, value: Number(e.target.value) })}
              onPointerUp={(e) => set(p, Number((e.target as HTMLInputElement).value))}
              onKeyUp={(e) => set(p, Number((e.target as HTMLInputElement).value))}
            />
            <span className="plugctl__text" title={p.text}>
              {dragging?.id === p.id ? '…' : `${p.text}${p.units && !p.text.endsWith(p.units) ? ` ${p.units}` : ''}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
