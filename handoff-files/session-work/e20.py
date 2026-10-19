W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'docs/ENGINE.md'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
phase2=open('/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/doc_phase2.md').read()
# Diagram update
rep("""                 GPU compositor (wgpu: D3D12 on Windows, Vulkan/GL elsewhere)
                 one pass per screen: Live, Back, Monitor (+ Next, half size)
                 + overlay layer per screen (RGBA from the web, on change)
                      │             │                  │
     native windows (Live, Back)    encoder feed       preview atlas (10/s)
     present, never waits for vsync read back → FFmpeg  → JPEG tiles → control window
                                    → capture.rs (files, RTMP fan-out)""","""                 GPU compositor (wgpu: D3D12 on Windows, Vulkan/GL elsewhere)
                 one pass per screen: Live, Back, Monitor (+ Next, half size)
                 + graphics planes per screen ◄── overlay renderer (hidden web
                   (dirty rectangles, on change)    window per screen, Canvas)
                      │             │                  │
     native windows (Live, Back)    encoder feeds      preview atlas (10/s)
     present, never waits for vsync scaled on the GPU, → JPEG tiles → control window
                                    read back → FFmpeg ◄── sound mix (audio worklet,
                                    → capture.rs          PCM stamped by wall clock)
                                    (files, RTMP fan-out, NDI, ISO files)""")
# Table rows
rep("""| Encoder feed     | `encoder.rs`                                                                                                  |""","""| Overlay renderer | `overlay.rs`, `app/src/engine/overlay{Renderer,Planes,Dirty,Wire}.ts`, `views/OverlayView.tsx`                 | Graphics drawn by the recorder's Canvas code in a hidden window per screen, sent as dirty rectangles of planes, drawn by the engine in their place among the pictures (below).                                                                                                                                                                                                                                                                                 |
| Encoder feeds    | `feeds.rs`, `audio.rs`, `app/src/audio/engineTap.ts`                                                          | Recording, stream, vertical, NDI and ISO files at once, with the WebView's sound mix (below).                                                                                                                                                                                                                                                                                                                                                                   |
| Encoder feed     | `encoder.rs`                                                                                                  |""")
# Insert phase2 before "What Unified (beta) does not do yet"
rep("""### What Unified (beta) does not do yet

Listed in the Engine dialog too:

- Graphics on the Live/Back windows (the overlay slot exists and is tested;
  the web overlay renderer that fills it is Phase 2). The Monitor (all words)
  stays a WebView window.
- Green screen, colour adjustments, frame delay, auto-framing on cameras (crop,
  zoom, pan, flip, rotate are done).
- Recording/streaming still use the Standard recorder by default (it has the
  sound); "Test the engine's recording" records 10 s, picture only, through the
  new path. While both run, the recorder's `getUserMedia` and the engine's Media
  Foundation reader open the same camera (Windows' Frame Server shares most
  USB cameras; some capture cards are exclusive — see risks).
- Stream (SRT/RTMP), web page, screen-capture and guest inputs; stinger videos
  (the pictures cut at the stinger's cut point); NDI.
- Group opacity: a layer made of several pictures (a split screen) fades each
  picture separately, so its background shows through its boxes mid-fade.
- Device-lost recovery (driver reset / TDR) — the engine reports GPU errors
  and carries on, but doesn't rebuild the device yet.""", phase2 + """
### What Unified (beta) does not do yet

Listed in the Engine dialog too:

- Green screen, colour adjustments, frame delay, auto-framing on cameras (crop,
  zoom, pan, flip, rotate are done).
- Stream (SRT/RTMP), web page, screen-capture and guest inputs; NDI inputs.
- A camera or video **behind** slides or Pesukim words (the slides and words
  are drawn; what is behind them is one of the engine's pictures, and a
  graphics plane can't have a picture inside it yet).
- Captions written into the stream picture; instant replay (it would draw the
  picture in the WebView again, cameras and all: it says so instead).
- The Monitor (all words) stays a WebView window; the Next previews show no
  graphics.
- Group opacity: a layer made of several pictures (a split screen) fades each
  picture separately, so its background shows through its boxes mid-fade.
- Device-lost recovery (driver reset / TDR) — the engine reports GPU errors
  and carries on, but doesn't rebuild the device yet.
- The vertical version has no drop shadow under the picture (the Standard
  one has a soft shadow).""")
# test plan additions
rep("""- `npx vitest run app/src/engine/unified.test.ts`: the engine's health feeding""","""- Phase 2, `cargo test -p lumora-live-engine`: the graphics wire format
  (round trip, malformed messages refused whole, the same bytes as the web
  side), overlay-channel looks and boxes (slide, zoom, wipe, cut out), feeds'
  constant frame rate (stalls, 30 on 60), sound placement (gaps, overlaps,
  early sound, silence when none comes), the sound bus; with FFmpeg: a real
  picture-and-sound encode whose decode has the flash and the tone within a
  frame of each other. `tests/gpu.rs`: a graphics plane fading in **among**
  the pictures (not pasted on top), dirty-rectangle patches and cleared
  planes, a lower third staying over a dip, PANIC black at once then its logo,
  three feeds at once (scaled, vertical, a camera's ISO) checked pixel by
  pixel, the test event's probe.
- Phase 2, vitest: `overlayWire` (same bytes as Rust), `overlayDirty` (tiles,
  joining, bounding box, pacing, back-pressure), `overlayPlanes` (which planes
  at which sizes), `overlayRenderer` (the real compositor in graphics-only
  mode on a painting test canvas: a camera on air sends nothing and opens
  nothing; a graphic is sent once, then nothing until it changes, then
  cleared; a refused frame starts over), `recorderUnified` (recording,
  stream, vertical, NDI from the engine: no camera opened, the right mix
  tapped, lost encoders reported, replay refused), `engineTap`,
  `engineReport`.
- `npx vitest run app/src/engine/unified.test.ts`: the engine's health feeding""")
# Phases
rep("""- **Phase 2** — the overlay renderer (one hidden WebView per screen rendering
  today's graphics components on a transparent background, frames to the
  engine on change via Windows Graphics Capture as `browser.rs` already does
  for web page inputs); recorder and stream on the engine feed with the
  WebView's sound mix piped as PCM; NV12 uploads and read-back; multiview drawn
  by the engine; stream/NDI/file inputs with hardware decode (`-hwaccel
d3d11va`); chroma key and colour adjustments in the shader (port of
  `chroma.ts`); stingers; group opacity; device-lost recovery.""","""- **Phase 2** — done: the overlay renderer (a hidden window per screen
  drawing today's graphics code on transparent planes, dirty rectangles to
  the engine on change: Canvas + IPC chosen over Windows Graphics Capture,
  see "Graphics" above); stingers (the `top` plane); recording, streaming,
  vertical, NDI and ISO files from the engine with the WebView's sound mix as
  PCM (no camera opened by the control window); the test event in Unified
  mode. Next: multiview drawn by the engine; NV12 uploads and read-back;
  stream/NDI/file inputs with hardware decode (`-hwaccel d3d11va`); chroma key
  and colour adjustments in the shader (port of `chroma.ts`); group opacity;
  device-lost recovery.""")
open(p,'w').write(s)
