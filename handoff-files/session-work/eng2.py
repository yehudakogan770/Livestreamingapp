p='editor/app/src/player/engine.ts'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
rep("""    if (this.playing && this.speed > 0 && this.p) {
      const ahead = frameOps(this.p, s, frame + Math.round(fps * 0.8));
      for (const n of videoNeeds(ahead)) if (!needs.some((x) => x.key === n.key)) needs.push({ ...n, time: n.time, key: n.key });
    }""","""    if (this.playing && this.speed > 0 && this.p) {
      for (const n of videoNeeds(this.aheadOps(s, frame, fps))) if (!needs.some((x) => x.key === n.key)) needs.push(n);
    }""")
rep("""    if (Math.abs(frame - this.ahead.frame) >= 6) {
      const next = frameOps(this.p, s, frame + Math.round(fps * 0.8 * this.speed));
      const now = new Set(allLayers(ops).map((l) => l.key));
      this.ahead = { frame, layers: allLayers(next).filter((l) => l.source?.kind === 'video' && !now.has(l.key)) };
    }
    for (const l of this.ahead.layers) want(l, Math.max(0, frame - l.clip.start), 8);
  }""","""    const now = new Set(allLayers(ops).map((l) => l.key));
    for (const l of allLayers(this.aheadOps(s, frame, fps))) if (l.source?.kind === 'video' && !now.has(l.key)) want(l, Math.max(0, frame - l.clip.start), 8);
  }

  /** What shows a little ahead of the playhead (worked out every few frames, not every refresh). */
  private aheadOps(s: Sequence, frame: number, fps: number): Op[] {
    const a = this.ahead;
    if (!this.p) return [];
    if (a.p !== this.p || Math.abs(frame - a.frame) >= 6) {
      this.ahead = { p: this.p, frame, ops: frameOps(this.p, s, frame + Math.round(fps * 0.8 * Math.max(1, this.speed))) };
    }
    return this.ahead.ops;
  }""")
rep("""  private ahead: { frame: number; layers: Layer[] } = { frame: -1e9, layers: [] };""","""  private ahead: { p: Project | null; frame: number; ops: Op[] } = { p: null, frame: -1e9, ops: [] };""")
open(p,'w').write(s)
print('ok')
