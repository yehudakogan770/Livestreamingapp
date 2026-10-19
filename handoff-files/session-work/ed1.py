import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='Timeline.tsx'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''  const time = useStore(store, (s) => s.time);
  const selection''','''  const selection''')
rep('''  const zoom = useStore(store, (s) => s.timelineZoom);
  const graph = useStore(store, (s) => s.graphProp);
  const [tab, setTab] = useState<'layers' | 'graph'>('layers');
  const c = compOf(project, compId);
  const scroller = useRef<HTMLDivElement>(null);
  const width = Math.max(400, c.duration * zoom + 40);''','''  const chosenZoom = useStore(store, (s) => s.timelineZoom);
  const graph = useStore(store, (s) => s.graphProp);
  const [tab, setTab] = useState<'layers' | 'graph'>('layers');
  const c = compOf(project, compId);
  const scroller = useRef<HTMLDivElement>(null);
  // The timeline's width: unless zoomed, the whole composition fits it.
  const root = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const fitZoom = avail > LEFT + 120 ? Math.max(ZOOM_MIN, (avail - LEFT - 28) / Math.max(0.1, c.duration)) : 120;
  const zoom = chosenZoom > 0 ? chosenZoom : fitZoom;
  const width = Math.max(chosenZoom > 0 ? 400 : 0, c.duration * zoom + 20);''')
rep('''    <div className="tt-timeline" data-testid="titler-timeline">''','''    <div className="tt-timeline" data-testid="titler-timeline" ref={root}>''')
rep('''        <span className="tt-tc" title="Playhead (minutes:seconds:frames)">
          {timecode(time, c.fps)}
        </span>''','''        <Timecode store={store} fps={c.fps} />''')
rep('''        <label className="tt-dim tt-zoomlabel">
          Zoom
          <input
            type="range"
            min={20}
            max={600}
            value={zoom}
            onChange={(e) => store.set({ timelineZoom: Number(e.target.value) })}
            aria-label="Timeline zoom"
          />
        </label>''','''        <label className="tt-dim tt-zoomlabel">
          Zoom
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            value={Math.round(zoom)}
            onChange={(e) => store.set({ timelineZoom: Number(e.target.value) })}
            aria-label="Timeline zoom"
          />
        </label>
        <button
          className={`tt-plain tt-fit${chosenZoom > 0 ? '' : ' on'}`}
          onClick={() => store.set({ timelineZoom: 0 })}
          title="The whole composition across the timeline"
          aria-pressed={chosenZoom <= 0}
        >
          Fit
        </button>''')
rep('''        <div className="tt-tl-body" ref={scroller}>''','''        <div
          className="tt-tl-body"
          ref={scroller}
          onWheel={(e) => {
            // Ctrl or Alt + wheel: zoom in time about the pointer.
            if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
            const el = scroller.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            const px = e.clientX - r.left - LEFT;
            const at = (px + el.scrollLeft) / zoom;
            const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
            store.set({ timelineZoom: next });
            requestAnimationFrame(() => (el.scrollLeft = Math.max(0, at * next - px)));
          }}
        >''')
rep('''                        cues: [...cc.cues, { id: uid('m'), t: time, name''','''                        cues: [...cc.cues, { id: uid('m'), t: store.get().time, name''')
rep('''                <div className="tt-playhead" style={{ left: x(time) }} />
              </div>''','''                <Playhead store={store} x={x} />
              </div>''')
rep('''              <div className="tt-playhead tall" style={{ left: LEFT + x(time) }} />''','''              <Playhead store={store} x={x} offset={LEFT} />''')
rep('''              x={x}
              time={time}
              keys={keys}''','''              x={x}
              keys={keys}''')
rep('''function Ruler({''','''/** The playhead's place in minutes:seconds:frames (its own small part: the rest stays still while playing). */
function Timecode({ store, fps }: { store: Store; fps: number }) {
  const time = useStore(store, (s) => s.time);
  return (
    <span className="tt-tc" title="Playhead (minutes:seconds:frames)">
      {timecode(time, fps)}
    </span>
  );
}

function Playhead({ store, x, offset = 0 }: { store: Store; x: (t: number) => number; offset?: number }) {
  const time = useStore(store, (s) => s.time);
  return <div className={`tt-playhead${offset ? ' tall' : ''}`} style={{ left: offset + x(time) }} />;
}

function Ruler({''')
rep('''}: RowProps & { pi: PropInfo; time: number; graph: { layer: string; path: string } | null }) {
  const p = getProp(l, pi.path);''','''}: RowProps & { pi: PropInfo; graph: { layer: string; path: string } | null }) {
  const time = useStore(store, (s) => s.time);
  const p = getProp(l, pi.path);''')
rep('''const LEFT = 300;''','''const LEFT = 300;
const ZOOM_MIN = 20;
const ZOOM_MAX = 1200;''')
open(p,'w').write(s)
p='store.ts'; s=open(p).read()
s=s.replace("timelineZoom: 120,","timelineZoom: 0,")
s=s.replace("  /** Pixels per second in the timeline. */","  /** Pixels per second in the timeline; 0: the whole composition fits. */")
open(p,'w').write(s)
