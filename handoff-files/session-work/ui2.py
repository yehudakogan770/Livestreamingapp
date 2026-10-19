def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (p, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('editor/app/src/ui/Timeline.tsx', [
("""export function PlayheadTime({ engine, fps, big }: { engine: Engine; fps: number; big?: boolean }) {
  const t = usePlayhead(engine);
  const [text, setText] = useState<string | null>(null);
  if (text !== null)""","""export function PlayheadTime({ engine, fps, big }: { engine: Engine; fps: number; big?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  // The clock is written straight to the page every frame (the panel isn't drawn again for it).
  const shown = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (text !== null) return;
    let last = '';
    const show = (frame: number) => {
      const s = timecode(Math.floor(frame), fps);
      if (s !== last && shown.current) {
        last = s;
        shown.current.textContent = s;
      }
    };
    show(engine.time);
    return engine.subscribeFrame(show);
  }, [engine, fps, text]);
  if (text !== null)"""),
("""            const f = parseTimecode(text, fps, t);""","""            const f = parseTimecode(text, fps, Math.floor(engine.time));"""),
("""      onClick={() => setText(timecode(t, fps))}
    >
      {timecode(t, fps)}
    </button>""","""      onClick={() => setText(timecode(Math.floor(engine.time), fps))}
    >
      <span ref={shown} />
    </button>"""),
("""function Playhead({ engine, zoom, height, scrollRef }: { engine: Engine; zoom: number; height: number; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const t = usePlayhead(engine);
  const playing = usePlaying(engine);
  const x = t * zoom;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    // Page along with the playhead while playing.
    if (x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 60;
    else if (x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 60);
  }, [x, playing, scrollRef]);
  return <div className="tl__playhead" style={{ transform: `translateX(${x}px)`, height }} />;
}""","""function Playhead({ engine, zoom, height, scrollRef }: { engine: Engine; zoom: number; height: number; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  // Moved straight on the page every frame (a CSS transform), not by drawing the timeline again.
  useEffect(() => {
    let last = -1;
    const place = (frame: number) => {
      const x = Math.floor(frame) * zoom;
      if (x === last) return;
      last = x;
      if (ref.current) ref.current.style.transform = `translateX(${x}px)`;
      const el = scrollRef.current;
      if (!el || !engine.isPlaying) return;
      // Page along with the playhead while playing.
      if (x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 60;
      else if (x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 60);
    };
    place(engine.time);
    return engine.subscribeFrame(place);
  }, [engine, zoom, scrollRef]);
  return <div ref={ref} className="tl__playhead" style={{ height }} />;
}"""),
])
print('ok')
