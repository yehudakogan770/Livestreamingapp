root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/app/src/ui/CompositePage.tsx', [
("""    graph(`Add ${kind === 'fx' ? (effectDef(fxType ?? '')?.name ?? 'effect') : NODE_DEFS[kind].name} node`, (gr, p) => {
      const r = addNode(gr, p, kind, at, fxType);
      id = r.id;
      // Put it in the chosen node's chain: what fed the chosen node now goes through it.
      const sel = gr.nodes.find((n) => n.id === u.compNode);
      let next = r.graph;""","""    graph(`Add ${kind === 'fx' ? (effectDef(fxType ?? '')?.name ?? 'effect') : NODE_DEFS[kind].name} node`, (gr, p) => {
      const sel = gr.nodes.find((n) => n.id === u.compNode);
      const feed = sel?.inputs[0] ? gr.nodes.find((n) => n.id === sel.inputs[0]) : undefined;
      // Into the chosen node's chain: halfway between it and what feeds it; otherwise where asked. Never on top of another node.
      const place = sel && feed && NODE_DEFS[kind].inputs.length ? { x: (sel.x + feed.x) / 2, y: (sel.y + feed.y) / 2 } : { ...at };
      while (gr.nodes.some((n) => Math.abs(n.x - place.x) < NODE_W - 20 && Math.abs(n.y - place.y) < 60)) place.y += 70;
      const r = addNode(gr, p, kind, place, fxType);
      id = r.id;
      // Put it in the chosen node's chain: what fed the chosen node now goes through it.
      let next = r.graph;"""),
("""  const chosen = g?.nodes.find((n) => n.id === u.compNode) ?? null;
""","""  const chosen = g?.nodes.find((n) => n.id === u.compNode) ?? null;
  // Every node in sight when a clip's graph is first shown.
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!g || !el || !clip || shownFor.current === clip.id) return;
    shownFor.current = clip.id;
    setPan(fitPan(g, el.clientWidth, el.clientHeight));
  });
"""),
("""  const fit = () => {
    const el = box.current;
    if (!el || !g.nodes.length) return;
    const minX = Math.min(...g.nodes.map((n) => n.x));
    const minY = Math.min(...g.nodes.map((n) => n.y));
    const maxX = Math.max(...g.nodes.map((n) => n.x + NODE_W));
    const maxY = Math.max(...g.nodes.map((n) => n.y + nodeHeight(n)));
    setPan({ x: Math.round((el.clientWidth - (maxX - minX)) / 2 - minX), y: Math.round((el.clientHeight - (maxY - minY)) / 2 - minY) });
  };""","""  const fit = () => {
    const el = box.current;
    if (el) setPan(fitPan(g, el.clientWidth, el.clientHeight));
  };"""),
("""/** The clip the page works on""","""/** The view's offset that centers every node. */
function fitPan(g: CompGraph, w: number, h: number): { x: number; y: number } {
  if (!g.nodes.length) return { x: 24, y: 24 };
  const minX = Math.min(...g.nodes.map((n) => n.x));
  const minY = Math.min(...g.nodes.map((n) => n.y));
  const maxX = Math.max(...g.nodes.map((n) => n.x + NODE_W));
  const maxY = Math.max(...g.nodes.map((n) => n.y + nodeHeight(n)));
  return { x: Math.round((w - (maxX - minX)) / 2 - minX), y: Math.round(Math.max(16, (h - (maxY - minY)) / 2) - minY) };
}

/** The clip the page works on"""),
("""      <p className="insp__note">{n.kind === 'fx' ? (effectDef(n.fx ?? '')?.name ?? '') + ' — ' : ''}{NODE_DEFS[n.kind].about}</p>""","""      <p className="insp__note">{n.kind === 'fx' ? `${effectDef(n.fx ?? '')?.name ?? 'An effect'} on its input.` : NODE_DEFS[n.kind].about}</p>"""),
])
