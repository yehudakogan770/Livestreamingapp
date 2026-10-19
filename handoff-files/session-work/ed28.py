import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='GraphEditor.tsx'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>([560, 200]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSize([Math.max(200, el.clientWidth), Math.max(120, el.clientHeight)]));
    ro.observe(el);
    return () => ro.disconnect();
  });''','''  // The plot takes the room it has (measured, so its lines and labels stay crisp).
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<[number, number]>([560, 200]);
  useEffect(() => {
    if (!box || typeof ResizeObserver === 'undefined') return;
    const measure = () => setSize([Math.max(200, box.clientWidth), Math.max(120, box.clientHeight)]);
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    measure();
    return () => ro.disconnect();
  }, [box]);''')
rep('''<div className="tt-graph-plot" ref={box}>''','''<div className="tt-graph-plot" ref={setBox}>''')
open(p,'w').write(s)
p='designer.css'; s=open(p).read()
rep('''.tt-graph-plot {
  flex: 1;
  min-height: 120px;
  overflow: hidden;
}
.tt-graph-plot svg {
  display: block;
}''','''.tt-graph-plot {
  flex: 1;
  min-height: 120px;
  overflow: hidden;
  background: var(--tt-field);
  border: 1px solid var(--tt-line);
  border-radius: 3px;
}
.tt-graph .tt-graph-plot svg {
  display: block;
  border: 0;
  background: none;
}''')
open(p,'w').write(s)
