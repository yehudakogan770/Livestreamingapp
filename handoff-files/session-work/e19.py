W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('app/src/views/EngineDialog.tsx', [
("""const NOT_YET = [
  'Titles, countdowns, scoreboards, lyrics and other graphics are not drawn on the Live and Back Screens yet (they arrive with the overlay renderer).',
  'Green screen, color adjustments and the frame delay are not applied to cameras yet (crop, zoom, move and flip are).',
  'Recording and streaming still use the Standard recorder (with its own copy of the cameras); “Test the engine’s recording” tries the new path, picture only.',
  'Stream, web page, screen capture and guest inputs, and stinger videos, are not in the engine yet.',
  'The test event is not supported in Unified (beta).',
];""","""const NOT_YET = [
  'Green screen, color adjustments and the frame delay are not applied to cameras yet (crop, zoom, move and flip are).',
  'Stream, web page, screen capture and guest inputs are not in the engine yet.',
  'A camera or video behind slides or behind Pesukim words is not shown yet (the slides and words are).',
  'Captions written into the stream picture, and instant replay, are not in Unified (beta) yet.',
];"""),
("""                  <dt>Late frames</dt>
                  <dd>
                    {s.lateFrames} of {s.frames}
                  </dd>""","""                  <dt>Late frames</dt>
                  <dd>
                    {s.lateFrames} of {s.frames}
                  </dd>
                  <dt>Graphics</dt>
                  <dd>
                    {s.overlay
                      ? `${s.overlay.framesPerS.toFixed(1)} updates a second (${s.overlay.mbPerS.toFixed(1)} MB/s), ${Math.round(s.overlay.latencyMs)} ms behind, ${s.overlay.planes} shown`
                      : '—'}
                  </dd>
                  <dt>Encoding</dt>
                  <dd>
                    {s.feeds?.length
                      ? s.feeds
                          .map(
                            (f) =>
                              `${f.kind === 'input' ? 'camera file' : f.kind === 'vertical' ? 'vertical' : 'picture'}: ${f.stats?.framesIn ?? 0} frames${f.stats?.framesDropped ? `, ${f.stats.framesDropped} late` : ''}${f.error ? ` (${f.error})` : ''}`,
                          )
                          .join('; ')
                      : 'nothing now'}
                  </dd>"""),
])
