root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/app/src/ui/CompositePage.tsx', [
("""      // Put it in the chosen node's chain: what fed the chosen node now goes through it.
      const sel = gr.nodes.find((n) => n.id === u.compNode);
      let next = r.graph;
      if (sel && NODE_DEFS[kind].inputs.length && sel.inputs[0] && kind !== 'merge') {
        next = connect(next, sel.inputs[0], id, 0);
        next = connect(next, id, sel.id, 0);
      } else if (sel && kind === 'merge' && sel.inputs[0]) {
        next = connect(next, sel.inputs[0], id, 0);
        next = connect(next, id, sel.id, 0);
      }
      return { graph: next, p: r.p };""","""      // Put it in the chosen node's chain: what fed the chosen node now goes through it.
      const sel = gr.nodes.find((n) => n.id === u.compNode);
      let next = r.graph;
      if (sel && NODE_DEFS[kind].inputs.length && sel.inputs[0]) {
        next = connect(next, sel.inputs[0], id, 0);
        next = connect(next, id, sel.id, 0);
      } else if (sel && !NODE_DEFS[kind].inputs.length && sel.kind === 'merge' && !sel.inputs[1]) {
        // A picture for a Merge node with no foreground yet.
        next = connect(next, id, sel.id, 1);
      }
      return { graph: next, p: r.p };"""),
])

edit('editor/app/src/render/compositor.ts', [
("""  /** What is under the layer being drawn (for a node composite's Background node). */""","""  /** Show one node of a clip's composite instead of its output (the Composite page's eye). */
  nodeView: { clip: string; node: string } | null = null;
  /** What is under the layer being drawn (for a node composite's Background node). */"""),
("""    let result = made.get(out.id) ?? null;""","""    const view = this.nodeView && this.nodeView.clip === layer.clip.id ? made.get(this.nodeView.node) : undefined;
    let result = view ?? made.get(out.id) ?? null;"""),
("""    for (const n of evaluationOrder(g)) {""","""    // The node shown in the viewer is worked out even when nothing joins it to the output.
    const order = evaluationOrder(g);
    const shown = this.nodeView && this.nodeView.clip === layer.clip.id ? g.nodes.find((n) => n.id === this.nodeView?.node) : undefined;
    if (shown && !order.includes(shown)) order.splice(order.length - 1, 0, ...evaluationOrder({ nodes: g.nodes.map((n) => (n.kind === 'out' ? { ...n, inputs: [shown.id] } : n)) }).filter((n) => !order.includes(n) && n.kind !== 'out'));
    for (const n of order) {"""),
])

edit('editor/app/src/player/engine.ts', [
("""  setMatte(m: { clip: string; node: string } | null) {""","""  private nodeView: { clip: string; node: string } | null = null;
  /** Show one node of a clip's composite in the viewer (the Composite page), or its output again (null). */
  setNodeView(v: { clip: string; node: string } | null) {
    if (v?.clip === this.nodeView?.clip && v?.node === this.nodeView?.node) return;
    this.nodeView = v;
    this.redraw();
  }

  setMatte(m: { clip: string; node: string } | null) {"""),
("""    c.matte = this.matte;
    c.space = spaceOf(s);""","""    c.matte = this.matte;
    c.nodeView = this.nodeView;
    c.space = spaceOf(s);"""),
])
