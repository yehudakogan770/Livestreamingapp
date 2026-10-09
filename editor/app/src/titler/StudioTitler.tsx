// Lumora Titler in Lumora Studio: the Titler graphics in "Text & more", a
// title clip's fields in the Inspector, and the designer ("Titler…") in its
// own window with Studio's own look (over the editor only where a window
// can't open). "Use in this clip" puts the title back into its clip, or adds
// a new title clip at the playhead.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { PanelBottom } from 'lucide-react';
import { fromTemplate, starterTemplates } from '../../../../titler/src/core/templates';
import type { TitleProject, Values } from '../../../../titler/src/core/types';
import { ControlPanel } from '../../../../titler/src/designer/ControlPanel';
import { webHost, type Host, type LibraryEntry } from '../../../../titler/src/designer/host';
import { tauriHost } from '../../../../titler/src/desktop/tauriHost';
import { inApp } from '../native';
import type { Clip } from '../model/types';
import { titlerMarks } from './titlerClip';
import { serveTitler, studioChannel, TitlerClient, type Channel } from './titlerWindow';
import './titler.css';

/** On a title clip in the timeline: where its IN ends and its OUT starts, and its keyframes. */
export function TitlerClipMarks({ clip, fps, zoom }: { clip: Clip; fps: number; zoom: number }) {
  const src = clip.source;
  if (src.kind !== 'titler') return null;
  const m = titlerMarks(src.project, clip.length, fps);
  const c = src.project.compositions.find((x) => x.id === src.project.main) ?? src.project.compositions[0]!;
  // Keyframe times as frames of the clip: the IN's from its start, the OUT's from where the OUT starts.
  const times = new Set<number>();
  const walk = (o: unknown) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      const k = (o as { k?: { t: number }[] }).k;
      if (Array.isArray(k)) for (const key of k) if (typeof key?.t === 'number') times.add(key.t);
      for (const v of Object.values(o)) if (v !== k) walk(v);
    }
  };
  walk(c.layers);
  const frames = [...times]
    .map((t) => (t >= c.markers.outStart ? m.outStart + Math.round((t - c.markers.outStart) * fps) : t <= c.markers.inEnd ? Math.round(t * fps) : -1))
    .filter((f) => f >= 0 && f <= clip.length);
  return (
    <>
      <i className="titler-mark titler-mark--in" style={{ left: m.inEnd * zoom }} title="The IN ends here" />
      <i className="titler-mark titler-mark--out" style={{ left: m.outStart * zoom }} title="The OUT starts here" />
      {[...new Set(frames)].map((f) => (
        <i key={f} className="titler-key" style={{ left: f * zoom }} />
      ))}
    </>
  );
}

const Designer = lazy(() => import('../../../../titler/src/designer/Designer').then((m) => ({ default: m.Designer })));

let shared: Host | null = null;
/** Studio's Titler files: the shared library in Documents/Lumora/Titles inside the app, the browser's otherwise. */
export function studioHost(): Host {
  shared ??= inApp() ? tauriHost('studio') : webHost();
  return shared;
}

const OPEN = 'studio-open-titler';

/** This window is Studio's Titler window (`?titler=<clip id or new>`). */
export function studioTitlerTarget(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('titler');
}

/**
 * Open the designer for a title clip (its id), or for a new title: in its
 * own window (in the app, and in a browser that allows it), else over the
 * editor.
 */
export function openStudioTitler(clipId?: string | null): void {
  const overlay = () => void window.dispatchEvent(new CustomEvent(OPEN, { detail: clipId ?? null }));
  const query = clipId ?? 'new';
  if (inApp()) {
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('titler_open_window', { query }))
      .catch(overlay);
    return;
  }
  if (import.meta.env.MODE === 'test') return overlay();
  // The Titler window if it is open already (kept as it is), else a new one.
  const w = window.open('', 'lumora-studio-titler', 'width=1440,height=900');
  if (!w) return overlay();
  try {
    if (w.location.href === 'about:blank') w.location.href = `${window.location.pathname}?titler=${encodeURIComponent(query)}`;
    else w.dispatchEvent(new CustomEvent('titler-open', { detail: query }));
  } catch {
    return overlay();
  }
  w.focus();
}

/**
 * Mounted once in the editor: answers the Titler window (the clip's title,
 * and its designs coming back), and shows the designer over everything when
 * it can't have its own window.
 */
export function StudioTitlerHost({
  clipOf,
  onUse,
  onAdd,
}: {
  clipOf: (id: string) => Clip | undefined;
  onUse: (p: TitleProject, clipId: string) => unknown;
  onAdd: (p: TitleProject) => string;
}) {
  const [open, setOpen] = useState<{ clip: string | null } | null>(null);
  const side = useRef({ clipOf, onUse, onAdd });
  side.current = { clipOf, onUse, onAdd };
  useEffect(() => {
    const on = (e: Event) => setOpen({ clip: (e as CustomEvent<string | null>).detail ?? null });
    window.addEventListener(OPEN, on);
    let stop: (() => void) | null = null;
    let gone = false;
    void studioChannel(inApp()).then((ch) => {
      if (gone) return;
      stop = serveTitler(ch, {
        clip: (id) => {
          const c = side.current.clipOf(id);
          return c?.source.kind === 'titler' ? { project: c.source.project, values: c.source.values, name: c.name } : undefined;
        },
        use: (p, id) => side.current.onUse(p, id),
        add: (p) => side.current.onAdd(p),
      });
    });
    return () => {
      gone = true;
      window.removeEventListener(OPEN, on);
      stop?.();
    };
  }, []);
  const clip = open?.clip ? clipOf(open.clip) : undefined;
  const src = clip?.source.kind === 'titler' ? clip.source : null;
  const initial = useMemo(() => (src ? (JSON.parse(JSON.stringify(src.project)) as TitleProject) : null), [src]);
  if (!open) return null;
  return (
    <div className="studio-titler" role="dialog" aria-modal="true" aria-label="Lumora Titler">
      <Suspense fallback={<div className="studio-titler__loading">Opening Lumora Titler…</div>}>
        <Designer
          key={open.clip ?? 'new'}
          host={studioHost()}
          initial={initial}
          look="studio"
          values={src?.values ?? {}}
          onUse={(p) => {
            if (clip) onUse(p, clip.id);
            else onAdd(p);
            setOpen(null);
          }}
          useLabel={clip ? 'Use in this clip' : 'Add to the timeline'}
          onClose={() => setOpen(null)}
        />
      </Suspense>
    </div>
  );
}

/** Studio's Titler window: the designer, with "Use" sending the design back to the editor window. */
export function StudioTitlerWindow({ channel }: { channel?: Channel }) {
  const [state, setState] = useState<{ target: string | null; project: TitleProject | null; values: Values; name: string; n: number } | null>(null);
  const [note, setNote] = useState('');
  const [inClip, setInClip] = useState(false);
  const client = useRef<TitlerClient | null>(null);
  useEffect(() => {
    document.title = 'Lumora Titler';
    const first = studioTitlerTarget();
    const target = first && first !== 'new' && first !== '1' ? first : null;
    let gone = false;
    let n = 0;
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<string>).detail;
      client.current?.ask(d && d !== 'new' ? d : null);
    };
    window.addEventListener('titler-open', onAsk);
    void (channel ? Promise.resolve(channel) : studioChannel(inApp())).then((ch) => {
      if (gone) return;
      client.current = new TitlerClient(ch, target, (m) => {
        setInClip(!!m.target);
        setState({ target: m.target, project: m.project, values: m.values, name: m.name, n: ++n });
      });
      client.current.ask(target);
      // Studio not answering (its window closed): start with a new title.
      setTimeout(() => !gone && setState((s) => s ?? { target: null, project: null, values: {}, name: '', n: ++n }), 1500);
    });
    return () => {
      gone = true;
      window.removeEventListener('titler-open', onAsk);
      client.current?.close();
    };
  }, [channel]);
  if (!state) return <div className="studio-titler__loading">Opening Lumora Titler…</div>;
  const close = () =>
    inApp() ? void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().close()) : window.close();
  return (
    <div className="studio-titler studio-titler--window">
      <Suspense fallback={<div className="studio-titler__loading">Opening Lumora Titler…</div>}>
        <Designer
          key={`${state.target ?? 'new'}-${state.n}`}
          host={studioHost()}
          initial={state.project}
          look="studio"
          values={state.values}
          onUse={(p) => {
            void client.current
              ?.use(p)
              .then((r) => {
                setNote(inClip ? `“${r.name}” now uses this design.` : `“${r.name}” was added to the timeline.`);
                setInClip(!!r.target);
              })
              .catch((e: unknown) => setNote(e instanceof Error ? e.message : String(e)));
          }}
          useLabel={inClip ? 'Use in this clip' : 'Add to the timeline'}
          onClose={close}
        />
      </Suspense>
      {note && (
        <div className="studio-titler__note" role="status" onAnimationEnd={() => setNote('')}>
          {note}
        </div>
      )}
    </div>
  );
}

/** "Text & more": the Titler templates, the shared library, and the designer. */
export function TitlerSection({ onAdd }: { onAdd: (p: TitleProject) => void }) {
  const [mine, setMine] = useState<LibraryEntry[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void studioHost()
      .listLibrary()
      .then(setMine)
      .catch(() => setMine([]));
  }, []);
  return (
    <div className="fxlist__group">
      <h3>Titler graphics</h3>
      <button type="button" className="btn btn--sm" onClick={() => openStudioTitler(null)} title="Design animated titles in Lumora Titler">
        Titler…
      </button>
      {mine.length > 0 && (
        <>
          <p className="fxlist__hint">Your titles ({studioHost().libraryName})</p>
          {mine.map((m) => (
            <button
              key={m.id}
              type="button"
              className="fxlist__item fxlist__item--gen"
              onClick={async () => {
                const r = await studioHost().readLibrary(m.id);
                if (r.project) onAdd(r.project);
                else setError(r.error ?? 'It could not be opened.');
              }}
            >
              <PanelBottom />
              {m.name}
            </button>
          ))}
        </>
      )}
      {error && <p className="fxlist__hint">{error}</p>}
      <p className="fxlist__hint">Templates</p>
      {starterTemplates().map((t) => (
        <button key={t.id} type="button" className="fxlist__item fxlist__item--gen" onClick={() => onAdd(fromTemplate(t))} title={t.description}>
          <PanelBottom />
          {t.name}
        </button>
      ))}
    </div>
  );
}

/** A title clip in the Inspector: its fields, where its IN and OUT are, and "Edit in Titler…". */
export function TitlerClipEditor({
  clip,
  fps,
  upd,
}: {
  clip: Clip;
  fps: number;
  upd: (c: Clip, label: string, f: (c: Clip) => Clip, final?: boolean, key?: string) => void;
}) {
  const src = clip.source;
  if (src.kind !== 'titler') return null;
  const values = Object.fromEntries(src.project.variables.map((v) => [v.key, src.values[v.key] ?? v.value]));
  const marks = titlerMarks(src.project, clip.length, fps);
  const c = src.project.compositions.find((x) => x.id === src.project.main) ?? src.project.compositions[0]!;
  return (
    <section className="sect">
      <header className="sect__head">
        <span className="sect__fold">
          <PanelBottom className="sect__icon" /> Titler graphic
        </span>
      </header>
      <div className="sect__body">
        <p className="insp__note">
          {src.project.name}. The IN plays for {(marks.inEnd / fps).toFixed(2)} s from the clip&rsquo;s start; the OUT takes the last{' '}
          {((clip.length - marks.outStart) / fps).toFixed(2)} s.
        </p>
        <ControlPanel
          project={src.project}
          values={values}
          onChange={(key, value) =>
            upd(
              clip,
              'Title field',
              (x) => (x.source.kind === 'titler' ? { ...x, source: { ...x.source, values: { ...x.source.values, [key]: value } } } : x),
              true,
              `titler-${clip.id}-${key}`,
            )
          }
        />
        <div className="insp__row">
          <button type="button" className="btn btn--sm" onClick={() => openStudioTitler(clip.id)}>
            Edit in Titler…
          </button>
          <button
            type="button"
            className="btn btn--sm"
            title="Make the clip as long as the title as designed"
            onClick={() => upd(clip, 'Title length', (x) => ({ ...x, length: Math.max(2, Math.round(c.duration * fps)) }))}
          >
            Length as designed ({c.duration.toFixed(1)} s)
          </button>
        </div>
      </div>
    </section>
  );
}
