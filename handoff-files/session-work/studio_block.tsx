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
  const overlay = () => window.dispatchEvent(new CustomEvent(OPEN, { detail: clipId ?? null }));
  const query = clipId ?? 'new';
  if (inApp()) {
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('titler_open_window', { query }))
      .catch(overlay);
    return;
  }
  if (import.meta.env.MODE === 'test') return overlay();
  const w = window.open(`${window.location.pathname}?titler=${encodeURIComponent(query)}`, 'lumora-studio-titler', 'width=1440,height=900');
  if (!w) return overlay();
  // Already open: it is asked for this clip.
  try {
    w.dispatchEvent(new CustomEvent('titler-open', { detail: query }));
  } catch {
    // Still loading: it asks by itself.
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
  onUse: (p: TitleProject, clipId: string) => void;
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

