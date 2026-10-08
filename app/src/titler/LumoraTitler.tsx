// Lumora Titler inside Lumora: "Titler…" (Overlays and Text menus, and a
// Titler graphic's card) opens the designer in its own window; in a browser
// (design work, tests) it opens over the control window instead. "Use in
// Lumora" puts the title back into its input, or adds a new Titler input.

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createEngineClient, isInsideLumora, type EngineClient } from '../engine/client';
import { useShow } from '../engine/useShow';
import type { Show } from '../engine/types/Show';
import type { TitleProject } from '../../../titler/src/core/types';
import { webHost } from '../../../titler/src/designer/host';
import { tauriHost } from '../../../titler/src/desktop/tauriHost';
import './titler.css';
import { brandTokens, projectOf, titlerKind, valuesOf } from './titlerSource';

const Designer = lazy(() => import('../../../titler/src/designer/Designer').then((m) => ({ default: m.Designer })));

const OPEN = 'lumora-open-titler';

/** Open the Titler for an input (its id), or for a new graphic (no id). */
export function openTitler(sourceId?: string | null): void {
  if (isInsideLumora()) {
    void invoke('titler_open_window', { query: sourceId ?? 'new' }).catch(() => window.dispatchEvent(new CustomEvent(OPEN, { detail: sourceId ?? null })));
    return;
  }
  window.dispatchEvent(new CustomEvent(OPEN, { detail: sourceId ?? null }));
}

/** This window is the Titler window (`?titler=<input id or new>`). */
export function titlerWindowTarget(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('titler');
}

/** The designer, set up for Lumora: its look, the event's look and fields, and where "Use" puts the title. */
export function TitlerEditor({
  client,
  show,
  target,
  onClose,
  onDone,
}: {
  client: EngineClient;
  show: Show;
  target: string | null;
  onClose?: () => void;
  onDone?: (msg: string) => void;
}) {
  const host = useMemo(() => (isInsideLumora() ? tauriHost('lumora') : webHost()), []);
  const src = target ? show.sources.find((s) => s.id === target && s.kind.type === 'titler') : undefined;
  const k = src?.kind.type === 'titler' ? src.kind : null;
  const initial = useMemo(() => (k ? projectOf(k) : null), [k?.template]); // eslint-disable-line react-hooks/exhaustive-deps
  const values = useMemo(() => (k && initial ? valuesOf(initial, k, show, Date.now()).values : {}), [initial]); // eslint-disable-line react-hooks/exhaustive-deps
  const use = (p: TitleProject) => {
    if (src && k) {
      void client.dispatch({ type: 'updateTitler', id: src.id, titler: { ...titlerKind(p, k.values), scoreboard: k.scoreboard } });
      onDone?.(`“${src.name}” now uses this design.`);
    } else {
      void client.dispatch({ type: 'addSource', source: { name: p.name, kind: titlerKind(p) } });
      onDone?.(`“${p.name}” was added to your inputs.`);
    }
  };
  return (
    <Suspense fallback={<div className="titler-loading">Opening Lumora Titler…</div>}>
      <Designer
        key={target ?? 'new'}
        host={host}
        initial={initial}
        look="lumora"
        brand={brandTokens(show.event.brand)}
        values={values}
        onUse={use}
        useLabel={src ? `Use in “${src.name}”` : 'Add to Lumora'}
        onClose={onClose}
      />
    </Suspense>
  );
}

/** The Titler window (opened by Lumora with titler_open_window). */
export function TitlerWindowView() {
  const client = useMemo(createEngineClient, []);
  const { snapshot } = useShow(client);
  const [target, setTarget] = useState<string | null>(() => {
    const t = titlerWindowTarget();
    return t && t !== 'new' && t !== '1' ? t : null;
  });
  const [note, setNote] = useState('');
  useEffect(() => {
    document.title = 'Lumora Titler';
    const on = (e: Event) => {
      const d = (e as CustomEvent<string>).detail;
      setTarget(d && d !== 'new' ? d : null);
    };
    window.addEventListener('titler-open', on);
    return () => window.removeEventListener('titler-open', on);
  }, []);
  if (!snapshot) return <div className="titler-loading">Opening Lumora Titler…</div>;
  return (
    <div className="titler-window">
      <TitlerEditor
        client={client}
        show={snapshot.show}
        target={target}
        onDone={setNote}
        onClose={() => (isInsideLumora() ? void getCurrentWindow().close() : window.close())}
      />
      {note && (
        <div className="titler-note" role="status" onAnimationEnd={() => setNote('')}>
          {note}
        </div>
      )}
    </div>
  );
}

/** In the control window: opens the Titler over it when there is no separate window (a browser). */
export function TitlerHost({ client, show }: { client: EngineClient; show: Show }) {
  const [open, setOpen] = useState<{ target: string | null } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setOpen({ target: (e as CustomEvent<string | null>).detail ?? null });
    window.addEventListener(OPEN, on);
    return () => window.removeEventListener(OPEN, on);
  }, []);
  if (!open) return null;
  return (
    <div className="titler-overlay" role="dialog" aria-modal="true" aria-label="Lumora Titler">
      <TitlerEditor client={client} show={show} target={open.target} onClose={() => setOpen(null)} onDone={() => setOpen(null)} />
    </div>
  );
}
