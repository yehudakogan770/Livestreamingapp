import sys
p = sys.argv[1]
s = open(p).read()


def rep(a, b, n=1):
    global s
    assert s.count(a) == n, (a[:80], s.count(a))
    s = s.replace(a, b)


rep('''  /** How long drawing a frame takes (ms, averaged). */
  composeMs: number;
}''', '''  /** How long drawing a frame takes (ms, averaged). */
  composeMs: number;
  /** Frames drawn in the last second while playing (what playback achieves). */
  fps: number;
  /** Frames drawn from the render cache while playing. */
  cached: number;
}''')
rep('''  readonly stats: PlaybackStats = { drawn: 0, dropped: 0, late: 0, composeMs: 0 };''', '''  readonly stats: PlaybackStats = { drawn: 0, dropped: 0, late: 0, composeMs: 0, fps: 0, cached: 0 };
  /** When frames were drawn while playing (the last second's, for the frame rate achieved). */
  private drawTimes: number[] = [];
  /** Cached pictures of heavy stretches (the render cache), when made and up to date. */
  cached: ((p: Project, s: Sequence, frame: number) => Op[] | null) | null = null;''')
rep('''  /** Start counting dropped frames again. */
  resetStats() {
    Object.assign(this.stats, { drawn: 0, dropped: 0, late: 0 });
  }''', '''  /** Start counting dropped frames again. */
  resetStats() {
    Object.assign(this.stats, { drawn: 0, dropped: 0, late: 0, fps: 0, cached: 0 });
    this.drawTimes = [];
  }

  /** The project being played (null before one is opened). */
  get project(): Project | null {
    return this.p;
  }

  /** The sequence's frame rate (what playback aims for). */
  get targetFps(): number {
    return this.seq ? rate(this.seq) : 30;
  }

  /** What to draw at a frame: the render cache's picture when it has one, else every layer. */
  private opsFor(s: Sequence, frame: number): Op[] {
    const p = this.p as Project;
    // A grade node's matte shows the real layers.
    const c = this.matte ? null : (this.cached?.(p, s, frame) ?? null);
    return c ?? frameOps(p, s, frame);
  }''')
rep('''    if (this.opsAt.p !== this.p || this.opsAt.frame !== frame) {
      ops = frameOps(this.p, s, frame);''', '''    if (this.opsAt.p !== this.p || this.opsAt.frame !== frame) {
      ops = this.opsFor(s, frame);''')
rep('''        this.stats.drawn++;
        this.lastDrawn = frame;''', '''        this.stats.drawn++;
        if (ops.length === 1 && ops[0]?.kind === 'layer' && ops[0].layer.key.startsWith('rcache:')) this.stats.cached++;
        const now = performance.now();
        this.drawTimes.push(now);
        while (this.drawTimes.length && (this.drawTimes[0] as number) < now - 1000) this.drawTimes.shift();
        this.stats.fps = this.drawTimes.length;
        this.lastDrawn = frame;''')
rep('''      this.ahead = { p: this.p, frame, ops: frameOps(this.p, s, frame + Math.round(fps * 0.8 * Math.max(1, this.speed))) };''', '''      this.ahead = { p: this.p, frame, ops: this.opsFor(s, frame + Math.round(fps * 0.8 * Math.max(1, this.speed))) };''')
open(p, 'w').write(s)
