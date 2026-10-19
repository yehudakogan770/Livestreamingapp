import sys
p = sys.argv[1]
s = open(p).read()


def rep(a, b, n=1):
    global s
    assert s.count(a) == n, (a[:80], s.count(a))
    s = s.replace(a, b)


rep('''  /** What to draw at a frame: the render cache's picture when it has one, else every layer. */
  private opsFor(s: Sequence, frame: number): Op[] {
    const p = this.p as Project;
    // A grade node's matte shows the real layers.
    const c = this.matte ? null : (this.cached?.(p, s, frame) ?? null);
    return c ?? frameOps(p, s, frame);
  }''', '''  /**
   * What to draw at a frame: the render cache's picture when it has one and
   * its file is ready to show, else every layer (the cache file is loaded
   * meanwhile, so the next frames come from it).
   */
  private opsFor(s: Sequence, frame: number, slot: 'now' | 'ahead'): Op[] {
    const p = this.p as Project;
    // A grade node's matte shows the real layers.
    const c = this.matte ? null : (this.cached?.(p, s, frame) ?? null);
    this.warming.delete(slot);
    if (c && this.ready(c)) return c;
    if (c) this.warming.set(slot, c);
    return frameOps(p, s, frame);
  }

  /** Cached pictures being loaded (shown once ready). */
  private warming = new Map<'now' | 'ahead', Op[]>();

  /** Can a cached picture be shown now (its video showing, or the frame decoded)? */
  private ready(ops: Op[]): boolean {
    const op = ops[0];
    const l = op?.kind === 'layer' ? op.layer : null;
    if (l?.source?.kind !== 'video') return true;
    const v = this.videos.get(l.key);
    if (v && v.el.readyState >= 2 && !v.el.seeking) return true;
    return !!this.cache.store.peek(frameKey(this.videoFile(l.source.media), l.source.time, l.source.media.fps || 30));
  }''')
rep('''    const frame = Math.floor(this.frame);''', '''    const frame = Math.floor(this.frame);
    // A cached picture that was loading is ready: show it.
    const now = this.warming.get('now');
    if (now && this.ready(now)) {
      this.warming.delete('now');
      this.opsAt.frame = -1;
      this.dirty = true;
    }''')
rep('''      ops = this.opsFor(s, frame);''', '''      ops = this.opsFor(s, frame, 'now');''')
rep('''ops: this.opsFor(s, frame + Math.round(fps * 0.8 * Math.max(1, this.speed))) };''', '''ops: this.opsFor(s, frame + Math.round(fps * 0.8 * Math.max(1, this.speed)), 'ahead') };''')
rep('''    const needs = videoNeeds(ops);''', '''    const needs = videoNeeds(ops);
    // Render cache files about to be shown are loaded too.
    for (const w of this.warming.values()) for (const n of videoNeeds(w)) if (!needs.some((x) => x.key === n.key)) needs.push(n);''')
rep("import { FrameCache, aheadCount, framesAhead } from './framecache';", "import { FrameCache, aheadCount, frameKey, framesAhead } from './framecache';")
open(p, 'w').write(s)
