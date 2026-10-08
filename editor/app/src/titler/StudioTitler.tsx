// Lumora Titler in Lumora Studio: the Titler graphics in "Text & more", a
// title clip's fields in the Inspector, and the designer opened over the
// editor ("Titler…") with Studio's own look. "Use in Studio" puts the title
// back into its clip, or adds a new title clip at the playhead.

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { PanelBottom } from 'lucide-react';
import { fromTemplate, starterTemplates } from '../../../../titler/src/core/templates';
import type { TitleProject } from '../../../../titler/src/core/types';
import { ControlPanel } from '../../../../titler/src/designer/ControlPanel';
import { webHost, type Host, type LibraryEntry } from '../../../../titler/src/designer/host';
import { tauriHost } from '../../../../titler/src/desktop/tauriHost';
import { inApp } from '../native';
import type { Clip } from '../model/types';
import { titlerMarks } from './titlerClip';
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

/** Open the designer for a title clip (its id), or for a new title. */
export function openStudioTitler(clipId?: string | null): void {
  window.dispatchEvent(new CustomEvent(OPEN, { detail: clipId ?? null }));
}

/** Mounted once in the editor: shows the designer over everything when asked. */
export function StudioTitlerHost({ clipOf, onUse }: { clipOf: (id: string) => Clip | undefined; onUse: (p: TitleProject, clipId: string | null) => void }) {
  const [open, setOpen] = useState<{ clip: string | null } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setOpen({ clip: (e as CustomEvent<string | null>).detail ?? null });
    window.addEventListener(OPEN, on);
    return () => window.removeEventListener(OPEN, on);
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
            onUse(p, clip ? clip.id : null);
            setOpen(null);
          }}
          useLabel={clip ? 'Use in this clip' : 'Add to the timeline'}
          onClose={() => setOpen(null)}
        />
      </Suspense>
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
