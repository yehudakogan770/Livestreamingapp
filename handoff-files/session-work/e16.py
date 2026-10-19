W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'app/src/broadcast/recorder.ts'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
rep("""import { engineCaptureStart, engineCaptureStop, onEngineFeedLost, sendEngineSound, unifiedOn } from '../engine/unified';""","""import { engineCaptureStart, engineCaptureStop, onEngineFeedLost, refreshEngineInfo, sendEngineSound, unifiedOn } from '../engine/unified';""")
rep("""  private untapMix(mix: 'master' | 'b'): void {
    const t = this.taps.get(mix);
    if (!t || --t.users > 0) return;
    t.tap.stop();
    this.taps.delete(mix);
  }""","""  private untapMix(mix: 'master' | 'b'): void {
    const t = this.taps.get(mix);
    if (!t || --t.users > 0) return;
    t.tap.stop();
    this.taps.delete(mix);
  }

  /** The engine's encoder, as {@link frameStats} reports the WebView's: frames a second sent, and late ones. */
  private engineFrames: { fps: number; target: number; dropped: number } | null = null;
  private enginePoll: ReturnType<typeof setInterval> | null = null;

  private watchEngine(target: number): void {
    if (this.enginePoll) return;
    let last: { n: number; t: number } | null = null;
    this.engineFrames = { fps: 0, target, dropped: 0 };
    this.enginePoll = setInterval(() => {
      void refreshEngineInfo()
        .then((i) => {
          const f = i?.stats?.feed;
          if (!f || !this.engineFrames) return;
          const now = performance.now();
          if (last && now > last.t) this.engineFrames.fps = Math.round(((f.framesIn - last.n) / ((now - last.t) / 1000)) * 10) / 10;
          this.engineFrames.dropped = f.framesDropped;
          last = { n: f.framesIn, t: now };
        })
        .catch(() => {});
    }, 1000);
  }

  private unwatchEngine(): void {
    if ([...this.live.values()].some((l) => l.engineMix)) return;
    if (this.enginePoll) clearInterval(this.enginePoll);
    this.enginePoll = null;
    this.engineFrames = null;
  }""")
rep("""    this.tapMix(mix);
    const live: Live = {""","""    this.tapMix(mix);
    this.watchEngine(q.fps);
    const live: Live = {""")
rep("""      await engineCaptureStop(live.running.session).catch(() => {});
      this.untapMix(live.engineMix);""","""      await engineCaptureStop(live.running.session).catch(() => {});
      this.untapMix(live.engineMix);
      this.unwatchEngine();""")
rep("""  frameStats(): { fps: number; target: number; dropped: number } | null {
    if (!this.fps) return null;""","""  frameStats(): { fps: number; target: number; dropped: number } | null {
    if (this.engineFrames) return { ...this.engineFrames };
    if (!this.fps) return null;""")
open(p,'w').write(s)
p=W+'app/src/broadcast/recorderUnified.test.ts'
s=open(p).read()
rep("""  sendEngineSound: () => Promise.resolve(),""","""  sendEngineSound: () => Promise.resolve(),
  refreshEngineInfo: () => Promise.resolve(null),""")
rep("""  expect(b.frameStats()).toBeNull();""","""  // The engine's encoder is what is measured (no picture drawn here).
  expect(b.frameStats()).toMatchObject({ target: 30 });""")
open(p,'w').write(s)
