W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('docs/ENGINE.md', [
("""### What Unified (beta) does not do yet
""","""### The multiview from the engine (Phase 2)

In Unified mode (Windows) Outputs → Multiview opens the engine's own window
(`Live::open_multiview`; it follows its display choice; switching engines
moves it over). The engine draws it from the **same GPU frames** as the
screens, at its full rate (`multiview.rs`, `LiveEngine::draw_multiview`):
the layout of `MultiviewView.css` (header strip; the Live Screen's Next and
On air big — and the Back Screen's for "both screens"; every input in a grid
of 260 px — 360 px for "inputs only" — tiles), each picture fitted in its
tile, gray, red (on air) or green (next) borders. The words — event name,
PANIC and blank tags, the clock, each tile's number, name, tally tags and
time — are the Live Screen's overlay renderer's plane `mv`
(`multiviewLabels.ts`), drawn at the engine's own layout (asked for with
`live_engine_multiview_layout`; the Rust and TypeScript sides are tested
against the same JSON). The clock changes once a second, so the plane sends
one small rectangle a second. The WebView multiview window (and its camera
copies) is not opened at all. Not yet: graphics inputs' tiles show only while
they are on air on the Live Screen (their planes are the renderer's), the Next
tiles show no graphics, and the timecodes count seconds, not frames.

### What Unified (beta) does not do yet
"""),
("""  mode. Next: multiview drawn by the engine; NV12 uploads and read-back;""","""  mode; the multiview drawn by the engine in its own window. Next: NV12 uploads and read-back;"""),
("""- The Monitor (all words) stays a WebView window; the Next previews show no
  graphics.""","""- The Monitor (all words) stays a WebView window; the Next previews (and the
  multiview's Next tiles) show no graphics; in the multiview a graphics
  input's tile shows it only while it is on air on the Live Screen."""),
])
edit('app/src/views/EngineDialog.tsx', [
("""  'Captions written into the stream picture, and instant replay, are not in Unified (beta) yet.',""","""  'Captions written into the stream picture, and instant replay, are not in Unified (beta) yet.',
  'In the multiview, the Next tiles show no graphics, and a graphics input’s tile shows it only while it is on air on the Live Screen.',"""),
])
