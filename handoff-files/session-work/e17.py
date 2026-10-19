W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'app/src/engine/unified.ts'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
rep("""export interface EngineStats {
  frames: number;
  msPerFrame: number;""","""/** How one of the engine's encoder feeds is doing. */
export interface EngineFeedStats {
  framesIn: number;
  framesDropped: number;
  bytesOut: number;
  /** Sound samples written (silence included), and silence filled in. */
  audioSamples: number;
  audioSilence: number;
  error: string | null;
}

export interface EngineStats {
  frames: number;
  /** Frames drawn in the last second. */
  fps: number;
  msPerFrame: number;""")
rep("""  feed: { framesIn: number; framesDropped: number; bytesOut: number; error: string | null } | null;""","""  feed: EngineFeedStats | null;
  /** Every feed: the recording, the stream, the vertical version, NDI (screens) and each camera's ISO file (inputs). */
  feeds: { id: number; kind: 'screen' | 'vertical' | 'input'; stats: EngineFeedStats | null; error: string | null }[];""")
rep("""/** Why the test event can't run now (null: it can). */
export function unifiedBlocksTestEvent(): string | null {
  return unifiedOn()
    ? 'The test event checks the Standard engine’s screen windows. It is not yet supported in Unified (beta): switch to Standard in Settings → Engine to run it.'
    : null;
}""","""/** Why the test event can't run now (null: it can). */
export function unifiedBlocksTestEvent(): string | null {
  start();
  return info && info.mode === 'unified' && !info.running
    ? `The unified engine is chosen but not running${info.error ? ` (${info.error})` : ''}. Switch to Standard in Settings → Engine, or start Lumora again, to run the test event.`
    : null;
}""")
open(p,'w').write(s)
