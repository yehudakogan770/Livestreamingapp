# The unified engine

How Lumora draws its pictures today, the ways it could draw them once, which
one was chosen and why, and what is built so far. The code is
`crates/live-engine` (the engine), `src-tauri/src/live.rs` (the app's side)
and `app/src/engine/unified.ts` (the control window's side). It is switched
on in **Settings → Engine → Unified (beta)**; **Standard stays the default**
and is unchanged.

## 1. Today: every window draws its own copy

| Step                  | Where                                                                                                                                               | What it costs                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cameras               | `app/src/engine/cameras.ts` (`acquireCamera`)                                                                                                       | `getUserMedia` per **window**: the control window, each output window and the multiview each open every camera they show (shared inside a window, never between windows). Each copy is decoded and color-converted separately.                                                                                                                                                                                            |
| Screen windows        | `src-tauri/src/outputs.rs` opens a WebView window per screen; `app/src/views/OutputView.tsx` → `ProgramView` in `app/src/components/ScreenView.tsx` | Each Live/Back window lays out the screen as DOM: one `<video>` per input, transitions as CSS/Web Animations (`transitionKeyframes`, sampled from `mixAt` in `app/src/engine/timing.ts`), luma wipes as CSS masks (`app/src/engine/luma.ts`), graphics as React components (`OverlaysView`, `SourceView`). The WebView's compositor (WebView2 GPU process) puts it on screen.                                             |
| Monitor               | `OutputView` → `MonitorScreen`                                                                                                                      | Words only; no cameras.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Multiview             | `app/src/views/MultiviewView.tsx`                                                                                                                   | Another set of `SourceView`s: another copy of every camera.                                                                                                                                                                                                                                                                                                                                                               |
| UI previews           | the control window's `ProgramView` / `PreviewView` / input tiles (`SourceView`)                                                                     | Settings → Engine (how it is doing: frame time, late frames, graphics, encoding; what is not in it yet); in Unified mode `SourceView` shows cameras from the engine's previews (the WebView never opens them); `EngineHealthWatch` feeds `inputHealth` (the backup lineup) from the engine; recording and streaming go through the engine (`recorder.ts`); the test event runs with the engine answering for its screens. |
| Recording / streaming | `app/src/broadcast/compositor.ts` (`ProgramCompositor`, 3 000+ lines)                                                                               | Draws the Live Screen **again** on a canvas with the same rules (`programLayers`), every graphic re-implemented in Canvas 2D; `captureStream` → `MediaRecorder` (WebView's encoder) → chunks over IPC → `src-tauri/src/capture.rs`, which writes files or pipes into FFmpeg (`src-tauri/src/encode.rs` picks NVENC / Quick Sync / AMF / x264).                                                                            |

So a 4-camera show with Live, Back, multiview and a recording opens each camera
three to four times and draws the Live Screen twice (DOM + canvas). Measured
in `docs/PERFORMANCE.md` ("Lumora"): with recording on, the control window's
main thread is **94 % busy**, ~60 % of it `drawImage` of the recording
compositor (software canvas); 17.4 ms of main thread per frame without it.

## 2. The options

### (A) One web renderer, frames carried to the other windows

One hidden WebView draws every screen (the existing `ProgramView` /
`ProgramCompositor`); the others receive its frames.

- Transport: WebRTC loopback (`RTCPeerConnection` between windows: an encode
  and decode per hop, 1–3 frames, quality loss), or readback to Rust
  (`getImageData` / `VideoFrame.copyTo`: ~8 MB per 1080p frame through IPC,
  500 MB/s at 60 fps, which WebView2 IPC cannot sustain) and native present.
- **For**: full graphics parity for free; smallest code change.
- **Against**: the heavy part (the picture) stays in the WebView, on its main
  thread, at the mercy of React, GC and a busy control window (rule 2 of
  `ARCHITECTURE.md`: "the engine never waits on the UI"); every frame crosses a
  process boundary at least once more; cameras are still `getUserMedia`. It
  moves the cost, it doesn't remove it.

### (B) A native Rust engine for everything

Cameras through Windows Media Foundation, files and streams through FFmpeg
(hardware decode), compositing on the GPU with wgpu (Direct3D 12), native
output windows, frames straight to the hardware encoder, previews to the UI as
small frames. What `ARCHITECTURE.md` always planned ("Engine: Rust; GPU
compositing: wgpu → Direct3D 12; Outputs: native full-screen windows").

- **For**: one copy of each camera; each screen drawn once; nothing on the UI
  thread; predictable latency; the encoder fed from the GPU.
- **Against**: every graphic (titles, lower thirds, scoreboards, countdowns,
  lyrics, Pesukim, credits, polls, the stage visuals, the 3D logo — dozens of
  React components and ~2 500 lines of their Canvas twins in
  `compositor.ts`) would have to be written a third time in Rust/WGSL, with
  text shaping (Hebrew, RTL), fonts, emoji. Years of parity work, and a
  permanent second implementation of every new graphic.

### (C) Hybrid: native engine for video, the web for graphics ✅

The native engine of (B) does what is heavy and timing-critical — cameras,
files, transitions, keys, layouts, outputs, encoding — and **one web overlay
renderer per screen** draws the graphics exactly as today (same React
components) into a transparent RGBA frame that is uploaded to the engine
**only when it changes** (most graphics change a few times a minute; a running
clock once a second; an animation in bursts).

- **For**: everything (B) gives for video, and full graphics parity because the
  graphics _are_ today's code. Graphics change rarely, so their cost is small
  and off the video path: a late overlay frame delays a title, never the
  picture.
- **Against**: two renderers to keep in step at the seam (z-order: graphics over
  inputs, under dip/blank/PANIC — the engine owns that order); an animated
  graphic (ticker, credits roll) uploads every frame while it moves (8 MB per
  1080p frame, ~0.5 ms on a discrete GPU; dirty-rectangle uploads in Phase 2).

**Decision: (C).** It is the only option that is both faster where it matters
and complete. (A) leaves the picture on the UI thread; (B) can't reach parity.
(C) is also incremental: the engine starts with the inputs and transitions
(this phase), graphics arrive through the overlay slot that already exists in
the compositor, and the Standard engine keeps working the whole time.

## 3. The unified engine (as built)

```
 cameras (MF) ─┐        ┌─ scene (pure): show + now → layers per screen ─┐
 files (FFmpeg)├─ mailbox per source (newest frame, pooled buffers)       │
 test pattern ─┘        └─────────────── upload once per new frame ──────┤
                                                                        ▼
                 GPU compositor (wgpu: D3D12 on Windows, Vulkan/GL elsewhere)
                 one pass per screen: Live, Back, Monitor (+ Next, half size)
                 + graphics planes per screen ◄── overlay renderer (hidden web
                   (dirty rectangles, on change)    window per screen, Canvas)
                      │             │                  │
     native windows (Live, Back)    encoder feeds      preview atlas (10/s)
     present, never waits for vsync scaled on the GPU, → JPEG tiles → control window
                                    read back → FFmpeg ◄── sound mix (audio worklet,
                                    → capture.rs          PCM stamped by wall clock)
                                    (files, RTMP fan-out, NDI, ISO files)
```

| Part             | File                                                                                                                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transition maths | `crates/live-engine/src/mix.rs`                                                                                                        | Line-for-line port of `mixOf`/`mixAt` (`timing.ts`) and `lumaValue` (`luma.ts`); same test cases as `timing.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Scene graph      | `crates/live-engine/src/scene.rs`                                                                                                      | `program_scene` = `programLayers` + `ProgramView`: TAKE progress from `lumora_engine::timing::transition_progress`, T-bar (cut/stinger fade on the bar), stinger cut point, dip/flash, blank (its own fade length, e.g. fade to black), PANIC; reveal/zoom-out on top. Inputs → pictures: crop/zoom/pan/flip/rotate from `Adjust` (same maths as `chroma.ts`), contain/cover, split screens (PiP, side by side, grid, custom boxes); graphics inputs are marked for the overlay renderer. Pure; unit tested.                                                                  |
| Sources          | `source.rs`, `mf.rs`                                                                                                                   | `VideoSource` trait; each source on its own thread, newest frame in a mailbox; health (starting / live / no signal after 1.5 s / failed, recovers on its own). Media Foundation camera (Windows; matched by name, Chrome's " (vid:pid)" dropped; ≤1080p, fastest mode; RGB32 via MF's video processor; retried every 2 s when unplugged). FFmpeg file/picture source (any OS), playing as the show says (playing or paused, from where, how fast — slow motion paced by the engine —, looping or holding its last picture; a change opens it again from there). Test pattern. |
| Frame pool       | `frame.rs`                                                                                                                             | Pixel buffers reused (one allocation per buffer size, tested).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Compositor       | `gpu.rs`, `compose.wgsl`                                                                                                               | One WGSL program: a quad per picture; shape (wipe rect, iris, diamond), luma wipe (patterns computed in the shader), blur, opacity, premultiplied "over"; bars around contained pictures drawn only outside the picture (so a fading picture never shows them through itself). Overlay layer per screen. Previews: every screen and input drawn small into one atlas, read back once.                                                                                                                                                                                         |
| Outputs          | `present.rs`                                                                                                                           | Windows: borderless popup covering the assigned display (or a 960×540 window), `WS_EX_NOACTIVATE` (never takes focus from the control window), Alt+F4 ignored (an audience screen never closes by accident); wgpu surface, Mailbox/Immediate present (three displays never stall the engine on vsync); letterboxed.                                                                                                                                                                                                                                                           |
| Overlay renderer | `overlay.rs`, `app/src/engine/overlay{Renderer,Planes,Dirty,Wire}.ts`, `views/OverlayView.tsx`, `monitorWords.ts`, `engineCaptions.ts` | Graphics drawn by the recorder's Canvas code in a hidden window per screen, sent as dirty rectangles of planes, drawn by the engine in their place among the pictures (below); also the Next previews' graphics, the stream's captions, the Monitor's words and the multiview's words and timecodes.                                                                                                                                                                                                                                                                          |
| Encoder feeds    | `feeds.rs`, `audio.rs`, `app/src/audio/engineTap.ts`                                                                                   | Recording, stream, vertical, NDI and ISO files at once, with the WebView's sound mix (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Encoder feed     | `encoder.rs`                                                                                                                           | Read back the Live Screen (pipelined: one frame late, never a stall) → raw RGBA into FFmpeg (wall-clock timestamps, CFR out; a frame FFmpeg can't take is dropped and counted, never queued without end) → encoded Matroska chunks → `capture.rs`'s normal recording/stream session (so files, destinations, reconnects and failure reporting are today's). Encoder arguments from `encode.rs` (hardware family picked as today).                                                                                                                                             |
| Engine loop      | `engine.rs`                                                                                                                            | `LiveEngine::frame(now)` and `Runner` (own thread, fixed rate, catches a panicking frame and carries on).                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Vision           | `vision.rs`, `app/src/engine/vision{Worker,Wire}.ts`, `views/VisionView.tsx`                                                           | Background removal, blur behind people and auto-framing: small frames of the cameras that use them to the web's person-finding models in a hidden window; masks, shots and pictures behind people back; applied in the shader (below).                                                                                                                                                                                                                                                                                                                                        |
| Zero-copy encode | `zerocopy.rs`, `zerocopy_win.rs`                                                                                                       | The screen feed's texture handed to the card's Media Foundation encoder (D3D12 → D3D11 shared texture and fences); read-back fallback; the route reported (below).                                                                                                                                                                                                                                                                                                                                                                                                            |
| Graphics cards   | `adapters.rs`                                                                                                                          | The engine's card (automatic: high performance, or chosen); outputs shown by their display's own card (`Bridge`).                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| HDR              | `hdr.rs`, `hdr.wgsl`, `gpu.rs` (`OutColor`)                                                                                            | HDR10/scRGB output windows; HDR10/HLG files and P010 cameras tone-mapped into the SDR picture.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Instant replay   | `replay.rs`, `src-tauri/src/live.rs` (`live_engine_replay_*`)                                                                          | The last minute of the Live Screen as hardware-encoded pieces on disk, taken as a playlist video the engine plays (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| App glue         | `src-tauri/src/live.rs`                                                                                                                | Mode saved in `live-engine.json`; `live_engine_info / set_mode / preview / health / test_record / graphics / audio / capture_start / capture_stop / probe / renderer_wants / vision_frames / vision_result / replay_start / replay_stop / replay_take`; `open_output`/`close_output` route Live, Back and the Monitor to the engine in Unified mode; the overlay renderer and vision worker windows opened and closed with it (`sync_renderers`); show changes forwarded from `announce`.                                                                                     |
| UI               | `app/src/engine/unified.ts`, `components/EnginePreview.tsx`, `views/EngineDialog.tsx`, `views/engineHost.tsx`                          | Settings → Engine (how it is doing: frame time, late frames, graphics, encoding; what is not in it yet); in Unified mode `SourceView` shows cameras from the engine's previews (the WebView never opens them); `EngineHealthWatch` feeds `inputHealth` (the backup lineup) from the engine; recording and streaming go through the engine (`recorder.ts`); the test event runs with the engine answering for its screens.                                                                                                                                                     |

### Graphics: the overlay renderer (Phase 2)

Each engine screen (Live, and Back while the engine shows it) has a hidden
renderer window, `overlay-live` / `overlay-back`
(`app/src/views/OverlayView.tsx`, `app/src/engine/overlayRenderer.ts`;
opened by `live::sync_renderers`). It draws the screen's graphics with the
recorder's own Canvas code — `ProgramCompositor` in a **graphics-only mode**
(`compositor.graphicsOnly`, `drawPlane`): the same fonts, animations,
build-ons and show clock that recordings have today — into transparent
**planes**, and sends the engine only the rectangles that changed:

| Plane             | What                                                                                                                                                                                         | Drawn by the engine                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `g:<input>`       | a graphics input (title, countdown, scoreboard, lyrics, slides, credits, stage visuals, 3D logo…) at the size it is shown: the whole screen, a split-screen box, or an overlay channel's box | in its own place among the pictures, with the transition's fade, wipe, slide, zoom, blur or luma wipe — exactly as a camera |
| `mv:g:<input>`    | a graphics input's multiview tile while it isn't on air on the Live Screen, at the tile's size                                                                                               | in its multiview tile                                                                                                       |
| `n:g:<input>`     | a graphics input lined up in Next, half size, only while the control window or the multiview shows that Next                                                                                 | in the Next preview, in its place                                                                                           |
| `top`             | the stinger video                                                                                                                                                                            | over the overlay channels, under blank and PANIC                                                                            |
| `panic`           | the PANIC safe screen's logo                                                                                                                                                                 | over the engine's own PANIC black (which is instant, whatever the renderer does)                                            |
| `cap`             | the live captions to write into the stream (Live)                                                                                                                                            | on the stream and its vertical version only — never on the screen or the recording (as the Standard recorder)               |
| `mon`             | the stage monitor's words (Live's renderer, for the Monitor's slot)                                                                                                                          | the whole Monitor, over its PANIC black                                                                                     |
| `mv`, `tc`, `tc2` | the multiview's words; its timecodes (header, screens' tiles)                                                                                                                                | over the multiview; the timecodes in their boxes                                                                            |

Which planes a screen needs comes from the same rules on both sides
(`overlayPlanes.ts` ↔ `scene.rs`): graphics layers of `programLayers`, the
graphics boxes of split screens, the overlay channels on the screen (their
animations — fade, slide, zoom, wipe — are ported to `scene::overlay_look`
and applied on the GPU), the stinger, PANIC. The engine draws, back to
front: the pictures (graphics planes in their layers), dip, flash, the
overlay channels (cameras and graphics alike), `top`, blank, PANIC, `panic`
— the web's order, so a lower third stays over a dip to black as it does
in the Standard engine.

**Transport — the choice.** Two ways were weighed (both in §2 (C)):

- _Windows Graphics Capture of a hidden WebView_ (as `browser.rs` captures web
  page inputs). DWM composes a window only while it is shown: a hidden or
  cloaked window yields no frames, so it would have to be a visible window
  parked off-screen; WGC then hands over the **whole window at the display's
  refresh rate, changed or not** (dirty regions only on Windows 11 22H2+), as
  BGRA that is premultiplied by the window's own background; its timing is
  DWM's, not the show clock's; and none of it can be tested off Windows.
- _Draw on a canvas and send what changed_ (chosen). The renderer draws each
  plane, reads it back (`getImageData`, a CPU canvas: `willReadFrequently`),
  compares it with what the engine already has in 32 × 32 tiles
  (`overlayDirty.ts: dirtyRects`), joins changed tiles into rectangles, and
  sends them as raw straight-alpha RGBA over Tauri's binary IPC
  (`live_engine_graphics`, a custom-protocol request: no base64, no JSON, no
  port to open). The wire format (`overlay.rs` / `overlayWire.ts`, tested on
  both sides against the same bytes) is records of a plane, its size, the
  time it was drawn for and its rectangles; a bad message is refused whole.
  Nothing changed: **nothing is sent**. Pacing (`Pacer`): the screen's rate
  while something changes (an animation, the show just changed) and for
  0.6 s after, otherwise a look 15 times a second; a frame still on its way
  holds the next back (the newest is drawn when it is free — never a queue);
  each frame is drawn a little ahead of the clock (half the measured round
  trip plus half a frame, at most 50 ms) so it is on the screen at its time.
  A refused frame makes the renderer start over (a reset, then every plane
  whole).

Measured here (Node/jsdom on the 4-vCPU container, so a ceiling): comparing
an unchanged 1080p plane 4.8 ms; packing a changed lower third (992 × 192, the
tiles around a 960 × 170 box: 0.76 MB) 1.8 ms; a whole 1080p plane 6.7 ms
(8.3 MB). A still title therefore costs a compare 15 times a second and no
upload; an animated full-screen graphic (a credits roll) uploads whole frames
at up to the screen rate — 8.3 MB a frame, back-pressured to what the IPC
takes. Most graphics are boxes (lower thirds, bugs), whose planes are only
their box. The engine reports the graphics' updates a second, MB/s, delay
and planes (Settings → Engine, "Graphics"; the test event's report).

The hidden windows run in their own WebView2 browser process (their own data
folder, `overlay-webview`), started with background throttling off
(`--disable-background-timer-throttling --disable-renderer-backgrounding
--disable-backgrounding-occluded-windows`: WebView2 needs one set of
arguments per data folder) — the Standard windows' arguments are untouched —
and tick from a worker's timer (a hidden page's own timers are slowed).
They open nothing: graphics-only mode never opens a camera or a video
(`drawSource` leaves every input the engine draws see-through), and they are
in their own capability (`capabilities/overlays.json`, core only).

### Recording and streaming from the engine (Phase 2)

In Unified mode `Broadcaster` (`app/src/broadcast/recorder.ts`) no longer
draws the picture or encodes it: `live_engine_capture_start` starts the
normal capture session (`capture.rs`: file, destinations, reconnects, backup
servers, rehearsals, NDI, the vertical version — unchanged) and an engine
**feed** that encodes the engine's own picture of the Live Screen into it as
the WebView's MediaRecorder did (H.264 at the session's `source_kbps` with
the hardware encoder `encode.rs` picks, Opus sound, Matroska;
`video/x-matroska;codecs=avc1,opus`, so every downstream path treats it as
before). The control window **opens no camera** for recording or streaming
any more (the double open of Phase 1 is gone); it only sends the sound.

- **Feeds** (`feeds.rs`): several at once (recording, stream, vertical, NDI,
  each camera's ISO file). A screen feed of another size is scaled on the GPU
  before it is read back (one read-back per picture per frame, shared by the
  feeds that use it); the vertical version is drawn on the GPU the way
  `VerticalFrame` draws it (the whole picture across the middle over a soft,
  darkened copy stretched up from a 48 × 27 target, with its soft shadow
  under the picture: a Gaussian-blurred rectangle, Phase 3). FFmpeg is started and
  finished on threads of its own (the engine never waits for a process).
- **Sound** (`app/src/audio/engineTap.ts` → `live_engine_audio` →
  `audio.rs` → `encoder.rs`): an audio worklet taps the mix the session uses
  (the Stream mix, or the Recording mix for recordings set to it), 40 ms at a
  time as 16-bit stereo, each piece stamped with the wall-clock time of its
  first sample (from the sound clock: `wallTimeOf`). FFmpeg reads it as a
  second input over a local connection it makes to the engine
  (`tcp://127.0.0.1:<port>`, accepted once).
- **Timing.** The picture is a constant frame rate counted on the wall clock
  from FFmpeg's start (`CfrClock`): a late engine frame is sent for every slot
  it missed, a frame FFmpeg couldn't take yet is owed and sent with the next
  one, the first frame primes FFmpeg (whose start-up — longer with a
  hardware encoder — is not counted), so frame _n_ is the picture at
  _start + n / fps_. Each sound piece is written at its own place in the
  sample stream (`AudioClock`): a gap becomes silence, an overlap is cut; with
  no sound arriving, silence keeps FFmpeg going 300 ms behind the clock.
  Measured end to end (FFmpeg reading its own file back, a flash and a tone
  made at the same moment, the sound sent 80 ms late): **flash and tone within
  one frame** (`picture_and_sound_together_when_ffmpeg_is_present`).
- **ISO files** come from the engine's own frames of each camera (no GPU, the
  pixels as Media Foundation gave them: `bgr0`/`bgra`/`rgba`), encoded with
  the same hardware encoder at the ISO bitrate into the usual
  `<recording> — event files` folder; the event file lists them as before.
  Microphones' own files stay the WebView's (sound only, no camera).
- A feed whose FFmpeg stops by itself is reported (`live-engine-feed-lost`) as
  the WebView's encoder stopping is, so the session starts again; a failing
  hardware encoder is marked failed (`capture.engine_hw_failed`) and the
  next attempt uses the processor.
- The **test event** runs in Unified mode: the engine answers the output
  check for its own windows (`live_engine_probe`: frame rate, on-air input
  really drawn, black, overlays drawn), the recording's frame rate is the
  engine feed's, and the report has the engine's numbers (graphics card,
  ms per frame, late frames, graphics updates and delay, each feed's frames,
  late frames, sound written and silence filled in).

### The multiview from the engine (Phase 2)

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
copies) is not opened at all. The Next tiles are the Next previews, graphics
included (see "Next previews" below). The **timecodes count frames**
(`HH:MM:SS:FF` at the engine's rate): they are two small planes of their own,
`tc` (the header's clock box, `Layout::clock`) and `tc2` (the screens' tiles,
`Tile::timecode`), drawn by the engine in each of those boxes every frame, so
only a few hundred bytes change a frame and the big words plane `mv` is drawn
and compared once a second (the renderer skips a plane whose stamp — the show
and the second — has not changed). A graphics input's tile shows its `g:`
plane while it is on air on the Live Screen; otherwise the Live Screen's
renderer draws it for the multiview alone, at the tile's size
(`mv:g:<input>`, `overlayPlanes.ts: multiviewPlanes`, Phase 3).

### More inputs and the picture processor on the GPU (Phase 2)

- **Stream, web page, screen-capture and guest inputs**: their pictures are
  already in the app's frame store (`browser.rs`: streams received by FFmpeg
  in `streams.rs`, pages, guests and screens captured with Windows Graphics
  Capture), as JPEG or PNG. The engine takes them from there directly (no
  HTTP: `EncodedFrames`, `EncodedSource`) and decodes them on each input's own
  thread (`zune-jpeg`, `png`), see-through PNGs keeping their alpha.
- **Green screen and light and color** (`look.rs`, `compose.wgsl: look`): the
  web picture processor's settings and order (`chroma.ts`) in the engine's one
  shader — blur or sharpness, the key on the colors as the camera saw them
  (chroma distance, softness, spill), white balance, exposure, brightness,
  shadows and highlights, contrast, gamma, saturation, black and white,
  vignette, grain — per picture, in the same pass that places it (no extra
  copy). Background removal, blur behind people and auto-framing: see below.
- **NV12 both ways**: cameras' frames cross to the GPU as NV12 (two planes,
  12 bits a pixel) and are made RGB there; the encoder feeds are made NV12 on
  the GPU and read back at a third of RGBA's bytes (see the cost table).
  Files are decoded with `-hwaccel auto` (D3D11 on Windows; FFmpeg falls back
  to the processor by itself). Tested: NV12 red (BT.601 and BT.709) drawn red,
  12 bits a pixel uploaded; the feeds' NV12 decoded back by FFmpeg to the
  right colors.
- **Picture delay** (`delay.rs`): a camera held back by its delay keeps its
  last frames (up to four seconds) and shows the one from that long ago.
- **Device-lost recovery**: a lost graphics device (a driver reset — Windows'
  TDR —, the card removed) is noticed (`set_device_lost_callback`) and a new
  one made from the same instance on the next frame (`LiveEngine::recover`):
  the screens' and feeds' targets are made again, the windows' surfaces
  configured again, the sources upload their next frames, and the overlay
  renderers' next frame is refused once so they send every plane whole. The
  Engine dialog counts the resets. Tested with `Device::destroy` on Linux
  (`a_lost_graphics_device_is_replaced_and_the_show_goes_on`); a real TDR
  (`dxcap -forcetdr`) needs Windows.
- **Group opacity**: a layer of several pictures (a split screen) that fades,
  wipes, blurs or luma-wipes is drawn whole into a see-through scratch target
  and faded as one (`gpu::needs_group`), so its background no longer shows
  through its boxes mid-fade.

### Background removal, blur behind people and auto-framing (Phase 3)

The web's person-finding models (MediaPipe's selfie segmenter and person
detector, `app/src/engine/vision.ts`: `InputVision`, the same code the
Standard processor runs) run in a **vision worker**: a hidden window
(`overlay-vision`, `views/VisionView.tsx`, `engine/visionWorker.ts`) in the
overlay renderers' own browser process (no background throttling), opened by
`live::sync_renderers` **only while an input uses** a background that isn't
kept or digital auto-framing (a PTZ camera is steered instead), and closed
when none does.

- **Frames out** (`vision.rs`): every second engine frame (at most 30 a second
  per camera, as the web's 33 ms), each such camera's newest frame — only a
  new one — is made small on the processor (at most 320 wide, its own shape;
  NV12 converted with the same BT.709/601 limited-range math as `yuv.wgsl`;
  no GPU read-back) and put in a mailbox. The worker long-polls it
  (`live_engine_vision_frames`, waits up to 250 ms; "LVF1": id, sequence,
  size, RGBA). Cameras that use none of these effects are never copied.
- **Answers back** (`live_engine_vision_result`, "LVR1", checked whole): the
  person mask (a byte a spot, at the model's size; none while the models are
  paused or failed, so the picture shows as it is), where auto-framing aims
  (none: wide), and — once, and again only when it changes — the picture
  behind the people (a file, or the virtual set's two layers, at most 1280
  wide). Wire format tested on both sides against the same bytes.
- **In the shader** (`compose.wgsl`, group 2: mask, picture behind, desk in
  front; uniforms `bg0`/`bg1`): the processor's own steps in its order —
  `person = smoothstep` of the mask with the edge's softness, portrait blur
  where there is no person (33 taps), alpha × person for "remove", the
  picture behind (filling the picture) and the virtual set's desk over it for
  "picture"/"set" — in the same pass that places the camera, with the green
  screen and light and color. A picture behind also works with a green
  screen's edge alone, as on the web.
- **Auto-framing**: the worker sends where the shot should go (the web's
  `frameFor` / `worthMoving`, its `aim`); the engine moves the shot toward it
  every frame (`step_shot`, a port of `stepShot`, at the input's speed) and
  turns it into the picture's zoom and pan (`shot_to_view`), wherever the
  camera shows (screens, Next, previews, multiview).
- **Latency budget.** The small frame is made when the engine takes the
  camera's frame; the worker has it within a millisecond (the long poll),
  the models take 5–15 ms on a graphics card, and the answer is used from
  the engine's next frame. So a mask is drawn on a picture 1–2 frames newer
  than the one it was found on (2–3 when the models are slow); the web's
  mask is blended with the last one too, so a moving edge trails a little in
  both. The picture is never held back for the mask. When the models take
  too long the web's safety net pauses them (no mask: the plain picture).
- Device loss: the masks went with the device; the worker's next answer is
  refused once and it sends everything again.
- Measured here: the shader's remove / picture-behind / portrait-blur paths
  and a mask sent and cleared, checked pixel by pixel (`tests/gpu.rs`); the
  worker with a stand-in model (`visionWorker.test.ts`). The models
  themselves (WebGL / WebGPU in WebView2) need Windows to be measured.

### Captions written into the stream (Phase 3)

As in Standard, the live captions (Moonshine / Whisper in the control
window) are written into the **stream** picture and its vertical version
when asked, never the recording: the control window passes the lines to the
Live Screen's overlay renderer (`engineCaptions.ts`, a Tauri event, again
every two seconds so a renderer that started since has them); it draws them
with the Standard `CaptionLayer`'s own drawing (`drawCaptions`) into the
plane `cap`, sent only when the lines change. The engine's stream and
vertical feeds (`FeedSource::Screen { captions: true }`) draw the Live
Screen into a target of their own and the `cap` plane over it — only while
there is one, otherwise they read the screen directly as before.

### Instant replay (Phase 3)

`live_engine_replay_start` starts one more encoder feed of the Live Screen
(30 fps, 8 Mb/s, the recordings' hardware encoder, the Stream mix's sound as
Opus) whose output is FFmpeg's segment muxer: pieces of 3 s on disk
(`<app data>/replay-ring`, each starting on a forced key frame), listed by
FFmpeg in a CSV; pieces older than a minute are deleted every two seconds.
`live_engine_replay_take` waits for the piece being written to finish (at
most 5 s, as the WebView buffer finished its current piece), picks the pieces
that cover the seconds asked and copies them into the replays folder; the
control window lines them up as a playlist video (`replay-…`, and the
highlights reel) exactly as before. **Playback is an engine source**: videos
now follow the show's playback (play, pause, position, speed, looping), so a
replay plays from its start when played, in slow motion when asked (turned
into 30 fps by FFmpeg and paced by the engine at 30 × speed), and holds its
last picture at the end; the playlist goes on to the next piece as the core
engine says. Nothing is drawn or encoded in a WebView; switching engines
stops the engine's replay (and says so).

### Graphics on the Next previews (Phase 3)

The Next previews (half size) are drawn with planes too: the screen's
renderer draws what is lined up in Next (`nextPlanes`: a graphics input, or
a split screen's graphics boxes) into `n:g:<input>` planes at Next's size,
**only while that Next is seen** — its preview asked for within the last
2.5 s by the control window, or the engine's multiview showing it
(`live_engine_renderer_wants`, asked every second). The engine draws Next
with the screen's planes and the `n:` prefix (`ScreenScene::plane_prefix`).

### The Monitor in the engine's window (Phase 3)

In Unified mode (Windows) the Monitor is one of the engine's own windows,
like Live and Back. Its words — clock, countdown, message, a song's words
and what comes next, the teleprompter, the candle-lighting band, flashing,
blank and PANIC dimming — are drawn by the Live Screen's renderer into the
plane `mon` (`monitorWords.ts`, a canvas port of `MonitorScreen.tsx` and its
CSS: the three layouts, sizes, colors, text made smaller to fit) and sent
for the Monitor's slot; the engine draws its own PANIC black under it. The
plane is redrawn ten times a second at most (every frame while it flashes or
the teleprompter rolls). The test event asks the engine about it as about
Live and Back.

### Behind slides and Pesukim words (Phase 3)

A camera, video, picture or color behind slides or the Pesukim words (and a
camera used as a slide, in the slides' area) is drawn by the engine: the
input's pictures are the background color, what is behind and the slide's
camera, with the slides' or words' plane over them; in graphics-only mode the
renderer leaves the background out (see-through), so the engine's pictures
show through. The layer is grouped when it fades, so it fades as one. A
camera or video coming up as a slide fades in with the slides' `slide-in`
(0.4 s, CSS ease-out, from the slide's change: `Placement::appear`), as the
web's slide does.

### Zero-copy encoding (Phase 3)

Before, each screen feed was converted to NV12 on the GPU, read back (one
frame late, 3.1 MB a frame at 1080p) and piped to FFmpeg, which handed it to
NVENC, Quick Sync or AMF — ≈190 MB/s across the bus and the pipe at 1080p60
for one feed. Now (`zerocopy.rs`, `zerocopy_win.rs`) the picture goes to the
graphics card's own encoder **as a texture**:

- **The path chosen: the vendors' Media Foundation hardware encoders.**
  NVIDIA, Intel and AMD each install a hardware H.264/HEVC encoder MFT with
  their display driver (`MFTEnumEx(MFT_ENUM_FLAG_HARDWARE)`); it takes
  Direct3D 11 textures through `IMFDXGIDeviceManager`. Nothing has to be
  shipped: linking libavcodec with D3D11 frames would mean shipping FFmpeg's
  shared libraries next to the app (CI bundles only `ffmpeg.exe`, the static
  "essentials" build) and a C build step; the three vendor SDKs (nvEncodeAPI,
  AMF, oneVPL) are three APIs to keep up with. The MFTs are what Windows' own
  camera app, Teams and the WebView's MediaRecorder use, so they are the most
  likely to work on an event PC, and CI is unchanged.
- **The hand-over.** Each feed gets a ring of three textures created by the
  engine's own Direct3D 12 device as shared resources (`D3D12_HEAP_FLAG_SHARED`,
  simultaneous access, so they decay to COMMON after every submit and D3D11
  can read them), wrapped as wgpu textures (`create_texture_from_hal`), and
  opened on a Direct3D 11 device made on the **same** card (matched by LUID).
  Two shared `ID3D12Fence`s are opened on D3D11 (`OpenSharedFence`): each frame
  the engine copies the feed's picture into the next ring texture — after a
  GPU-side wait on `free` for that texture (`wgpu-hal`'s `add_wait_fence`) —
  and signals `drawn` after the copy (`add_signal_fence`). The encoder's
  thread (all COM objects live there) waits on `drawn` on the GPU
  (`ID3D11DeviceContext4::Wait`), turns the RGBA texture into NV12 with the
  card's video processor (BT.709, limited range: the colors the read-back
  path's `fs_nv12` makes; `VideoProcessorSetOutputColorSpace1`), signals
  `free`, and gives the NV12 texture to the encoder
  (`MFCreateDXGISurfaceBuffer`, asynchronous MFTs driven by their
  `METransformNeedInput` / `HaveOutput` events, synchronous ones too). No
  pixel crosses to the processor and the engine never waits.
- **Settings are the app's** (`encode.rs` → `live.rs: zero_copy`): the
  operator's encoder choice picks the vendor (NVENC → NVIDIA's MFT, Quick Sync
  → Intel's, AMF → AMD's), constant bitrate for streams or constant quality
  with a ceiling, the speed preset (`CODECAPI_AVEncCommonQualityVsSpeed`), a
  keyframe every 2 seconds (`CODECAPI_AVEncMPVGOPSize`; the replay's: one per
  3-second piece), no B-frames, low-latency mode, High profile, BT.709 tags.
  The processor encoder (x264) keeps the read-back path.
- **Into the same sessions.** The encoded elementary stream is written to the
  feed's FFmpeg, which now copies the picture (`-f h264 … -c:v copy`,
  `encoder::encoded_input`) and adds the sound as before, so files,
  destinations, reconnects, backups and NDI are unchanged. Parameter sets
  kept out of the stream by an encoder are put in front of the first frame
  (`MF_MT_MPEG_SEQUENCE_HEADER`).
- **Feature detection and fallback.** The engine on Vulkan/GL (not D3D12), no
  MFT of the chosen vendor on the engine's card, a video processor that can't
  make NV12, settings or sizes the encoder refuses, or no answer within 10 s:
  the feed reads back as before, and its route says why. An encoder that fails
  mid-stream ends the picture with its reason (the session starts again as for
  any lost encoder) and zero-copy is not tried again until Lumora restarts
  (`zerocopy::broken`, shown in the Engine dialog); a lost graphics device
  ends it too (its textures went with the device) without that.
  `LUMORA_NO_ZERO_COPY=1` turns it off.
- **Reported.** Each screen feed has a route (`FeedInfo.route`: "zero-copy:
  NVIDIA NVENC H.264 on … (Media Foundation, …)" or "read back as NV12 to
  FFmpeg (why)"), shown in the Engine dialog, the engine's test recording
  ("Test the engine's recording") and the test event's report.
- **Tested here** with a stand-in (`zerocopy::standin`): the same ring of
  textures and GPU copies, read back and encoded by x264 in a second FFmpeg —
  the engine's side, the frames owed and the encoded picture into the file are
  checked end to end (`zero_copy_hands_the_picture_over_on_the_gpu…`), with
  the fallback (`zero_copy_that_cannot_open_reads_back_and_says_why`). The
  D3D12/D3D11/Media Foundation part compiles for Windows from Linux and needs
  NVIDIA, Intel and AMD cards to run.

### Graphics cards: the engine's and each output's (Phase 3)

- **The engine's card** (Settings → Engine → Graphics card): automatic is the
  high-performance card (`PowerPreference::HighPerformance`: on a hybrid
  laptop the NVIDIA/AMD one; Windows' per-app graphics setting still wins), or
  one chosen from the list (`adapters::cards`: every card with the displays it
  drives, from DXGI `EnumOutputs`). The choice is kept in `live-engine.json`;
  changing it starts the engine again on that card (its windows reopen there,
  graphics and person masks are sent again; refused while recording,
  streaming or keeping replays). A chosen card that is gone falls back to the
  high-performance one, and says so.
- **Each output window** (Live, Back, Monitor, multiview) is shown by the
  engine's card by default — on a hybrid laptop with the projector on the other
  GPU, Windows copies each frame across. Per output, "Shown by its display's
  own graphics card" makes the engine do it instead (`adapters::Bridge`): a
  small compositor on the card that drives that display (found by the
  display's rectangle), the screen read back one frame late on the engine's
  card (pipelined, never waiting) and uploaded there, and the window presented
  and flipped on its own card. The Engine dialog and the test event list each
  window's card, whether it was copied and its colors.

### HDR (Phase 3)

- **HDR outputs.** Per output, "HDR when its display shows HDR" (default off:
  SDR). When the display reports HDR (wgpu's `display_hdr_info`, from DXGI)
  the window's swap chain becomes HDR10 (`Rgb10a2Unorm`, BT.2100 PQ) or, where
  only that is offered, scRGB (`Rgba16Float`, linear); the present pass
  (`compose.wgsl: to_hdr`) puts the engine's SDR picture and graphics at SDR
  white — 203 nits (BT.2408) by default, set in the dialog — instead of
  leaving it to Windows' SDR brightness slider; BT.709 colors are placed in
  BT.2020 unchanged. A display that isn't in HDR keeps SDR.
- **HDR inputs.** A video file in HDR10 (PQ) or HLG (`ffprobe`'s
  `color_transfer`) is decoded as 10-bit RGB (`x2bgr10le`) instead of being
  clipped by FFmpeg; a camera or capture card whose mode is P010 with a PQ or
  HLG transfer function is read as P010. On the GPU (`hdr.wgsl`, once per new
  frame, like NV12) the signal becomes light (PQ absolute; HLG on BT.2100's
  1000-nit reference display), BT.2020 becomes BT.709, diffuse white (203
  nits) lands at the top of SDR and highlights roll off smoothly above 75 %
  (a soft shoulder, never a hard clip). The same maths in `hdr.rs` makes the
  vision worker's small frames, and the GPU test holds the shader to it.
- **Still SDR inside.** The engine composites in 8-bit SDR (BT.709,
  sRGB-encoded, as the web canvases), so an HDR input on an HDR output is
  tone-mapped down and placed back at SDR white: no highlights above SDR white
  on HDR displays and in recordings. Keeping HDR end to end would need 16-bit
  float screen targets and an HDR10 encode (P010, BT.2020/PQ tags).

### Blackmagic capture cards and program out

- **Capture** (`crates/decklink`, `live-engine/src/decklink.rs`): a stream
  input with a `decklink://<card>?input=sdi&audio=3-4` address is opened
  through the DeckLink API of Blackmagic Desktop Video (COM, hand-written
  interface definitions; FFmpeg's DeckLink support is "nonfree" and can't be
  shipped). Format detection reopens the input in the signal's mode; 8-bit
  YUV (UYVY) is made NV12 on the card's thread and made RGB on the GPU like a
  camera's (v210 is unpacked first; RGB signals are passed on as BGRA). One
  capture per card and connector is shared by the engine source, the
  Standard engine's frame store (JPEG, 30 a second, `src-tauri/src/decklink.rs`)
  and the mixer (the chosen pair of up to 16 embedded channels). Without
  Desktop Video the input fails with how to install it.
- **Program out**: an engine feed of the Live Screen whose FFmpeg writes
  raw UYVY (no encoder), split into frames and shown with
  `DisplayVideoFrameSync` on the card's output (Settings → Blackmagic
  program out…). Picture only.
- Compile-checked for Windows from Linux; needs a card to run (see the test
  plan's hardware list).

### What Unified (beta) does not do yet

Everything in the Standard engine is in Unified. Listed in the Engine dialog
are the parts still to be checked on Windows hardware (each falls back by
itself, and the dialog and the test event say which way was used):

- zero-copy encoding on NVIDIA, Intel and AMD cards (else the read-back path);
- the engine's card choice and outputs shown by their display's own card, on
  hybrid laptops and two-card desktops (else the engine's card, Windows copying);
- HDR outputs on HDR displays and HDR cameras and capture cards (else SDR).

## 4. Latency, CPU and GPU

**Latency** (camera to display, 60 fps): MF delivers a frame (≈1 frame
inside the camera/driver, as for `getUserMedia`), the mailbox holds it until
the next engine tick (0–1 frame, 0.5 on average), draw + Mailbox present
(≈1 frame). ≈2.5 frames, within `ARCHITECTURE.md`'s "under 3 frames"; the
WebView path adds the video element's own queue and the WebView2 GPU process's
compositor (typically 3–4 frames). Recording latency doesn't matter (A/V sync
does: wall-clock timestamps on both).

**Per frame, 1080p60, 4 cameras, 3 screens + encoder** (estimates for a
mid-range discrete GPU, to be confirmed on the hardware matrix below):

| Work                    | Cost                                                                                                                     | Note                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload 4 camera frames  | 4 × 3.1 MB NV12 = 0.75 GB/s (it was 4 × 8.3 MB RGBA = 2 GB/s before Phase 2)                                             | Done in Phase 2: cameras deliver NV12 (Media Foundation's own format; RGB32 only when a camera can't), uploaded as two planes and made RGB on the GPU once per new frame (`yuv.wgsl`; BT.709 for HD, BT.601 below). On integrated GPUs uploads are memory copies.                                             |
| Draw 3 screens + 2 Next | ~10 full-screen quads at 1080p ≈ 20 Mpx of simple fragments                                                              | < 1 ms on any discrete GPU; ~2 ms on Intel Iris Xe.                                                                                                                                                                                                                                                           |
| Present 2 windows       | blits                                                                                                                    | < 0.3 ms                                                                                                                                                                                                                                                                                                      |
| Encoder read-back       | 3.1 MB/frame NV12 = 190 MB/s download (RGBA was 8.3 MB = 500 MB/s); pipelined (two buffers, one frame late), so no stall | Done in Phase 2: each screen feed is converted to NV12 on the GPU (`fs_nv12`, BT.709 limited, tagged so) and read back as such; hardware encoders take NV12 as it is. Phase 3 (Windows): none at all with zero-copy — the texture goes to the card's encoder (a GPU copy and an NV12 conversion on the card). |
| Previews                | one 1920×540 atlas read back 10×/s + JPEG of ~9 tiles                                                                    | ~1 ms every 6th frame                                                                                                                                                                                                                                                                                         |
| Engine CPU              | scene maths for 3 screens: **0.01 ms**; the rest is driver submission                                                    | Measured (below).                                                                                                                                                                                                                                                                                             |

The WebView path, by comparison, spends its time in the control window's main
thread (94 % busy with recording on a software canvas, `PERFORMANCE.md`) plus
one camera decode per window.

### Benchmark (`live-bench`)

```sh
cargo run -p lumora-live-engine --release --bin live-bench -- 300 [--size=WxH] [--encode] [--paced]
```

Four synthetic 1080p60 sources; Live takes every second with a different
transition (fade, wipe, slide, dip, iris, luma clock, zoom, blur); Back shows a
four-way split; Monitor and Live have an overlay re-uploaded every second;
three screens drawn and copied to three stand-in windows; Live read back every
frame for the encoder; previews 10×/s.

Measured on the development container (4 vCPU shared with other jobs,
**no GPU: llvmpipe, Mesa's software rasterizer, through OpenGL**), so every
pixel is drawn by the CPU — these numbers are a floor for correctness and an
upper bound for cost, not a prediction for an event PC. The machine's load
moved a lot between runs (shown), so compare rows with the same load only:

| Run (load average)                                      | ms / frame (avg / p95) | Of which                                                                                               |
| ------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| 1080p, 300 frames, synchronous read-back (≈ 10)         | 342 / 576              | upload 51, draw 64, outputs 156, encoder read-back 107                                                 |
| 1080p, 150 frames, pipelined read-back (≈ 5)            | 149 / 185              | upload 26, draw 43, outputs 73, encoder read-back 5                                                    |
| 640×360, 120 frames, synchronous read-back (≈ 10)       | 88.7 / 131             | upload 30, draw 19, outputs 26, read-back 11                                                           |
| 640×360, 120 frames, pipelined read-back (≈ 5)          | 53.7 / 66              | upload 26, draw 11, outputs 15, read-back 0.6                                                          |
| 640×360 + FFmpeg x264 feed, 90 frames (≈ 10)            | 98.9 / 161             | 90 frames in, **0 dropped**                                                                            |
| Phase 2, 640×360 + x264 feed (NV12), 120 frames (≈ 1.6) | 44.0 / 53.9            | upload 20.8, draw 7.3, previews 11.8, feed (NV12 pass + read-back) 4.8; 114 frames in, **0 dropped**   |
| Phase 2, 1080p + x264 feed (NV12), 150 frames (≈ 1.6)   | 132 / 155              | upload 23, draw 12, previews 45, feed 35.5 (the NV12 pass runs on the CPU here); 143 in, **0 dropped** |
| Scene maths, 3 screens (CPU only, any run)              | **0.01 ms**            |                                                                                                        |

The encoder read-back is pipelined (`Compositor::read_pipelined`: two buffers
take turns, each frame returns the previous frame's pixels, so the engine
never waits for the copy): 107 → 5 ms at 1080p here, part of it the lower load.

For comparison, the web numbers in `PERFORMANCE.md` were measured on the same
kind of GPU-less VM: control window 17.4 ms of main thread per frame without
recording (~30–35 fps) and 94 % busy with it — and that is for **one** window;
each output window and the multiview pay again. On llvmpipe the engine's cost
is all fill rate on the CPU (it draws ~10 full-screen 1080p passes plus three
copies per frame), which a GPU does in about a millisecond. **The number that
matters — ms/frame on a real GPU — has to be measured on Windows hardware**
(run the same command there; the Engine dialog also shows live ms/frame and
late frames).

## 5. Windows risks

| Risk                    | What could happen                                                                                                                                                                       | Plan                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Camera exclusive access | A camera opened by the engine (MF) and by a WebView (`getUserMedia` in the Standard recorder, Zoom/Teams) fails in one of them.                                                         | Windows 10 1809+ Frame Server shares most USB (UVC) cameras between processes; capture cards (Magewell, Elgato, Blackmagic) are often exclusive. Since Phase 2 the recorder is on the engine feed (ISO files too), so in Unified mode Lumora opens each camera exactly once. The engine reports "being used by another program" and retries every 2 s. |
| DPI                     | Windows placed in logical pixels land wrong on a 150 % display.                                                                                                                         | The engine places windows in physical pixels from Tauri's monitor list (`outputs::displays`), and Tauri makes the process Per-Monitor-V2 aware, which the engine's own Win32 windows inherit.                                                                                                                                                          |
| HDR displays            | An 8-bit swapchain on an HDR desktop looks washed out or dim.                                                                                                                           | DWM composites SDR swapchains correctly on HDR desktops (sRGB → scRGB); we use `Bgra8Unorm` by default. Phase 3: per output, an HDR10 (PQ) or scRGB swap chain with SDR white at a set level (203 nits) when the display is in HDR.                                                                                                                    |
| Hybrid-GPU laptops      | The engine picks the NVIDIA GPU (HighPerformance) while the projector's HDMI port hangs off the Intel GPU: every present is a cross-adapter copy; or Windows forces the integrated GPU. | wgpu reports the adapter (shown in the Engine dialog, with why). Phase 3: the card can be chosen in Settings → Engine, and each output can be shown by its display's own card (DXGI `EnumOutputs`; the engine copies the picture across, one frame late). Test matrix includes Optimus/Advanced-Optimus laptops.                                       |
| WebView2 GPU process    | Standard and Unified share the GPU: WebView2's GPU process (D3D11) and the engine (D3D12) contend; a driver reset kills both.                                                           | In Unified mode the WebViews draw much less (no camera video, no output windows). Device-lost recovery for the engine is Phase 2; the Standard engine is one switch away.                                                                                                                                                                              |
| Fullscreen and focus    | A popup over the projector steals focus or is minimised by a focus change; Alt+F4 closes the projector.                                                                                 | `WS_EX_NOACTIVATE`, never minimised, `WM_CLOSE` ignored; borderless popups covering a monitor get DWM's independent flip.                                                                                                                                                                                                                              |
| Antivirus / FFmpeg      | The FFmpeg pipe is slow or blocked.                                                                                                                                                     | Same FFmpeg the app already ships and probes (`capture::find_ffmpeg`); dropped feed frames are counted and shown.                                                                                                                                                                                                                                      |

## 6. Test plan

**Automated (every change)**

- `cargo test -p lumora-live-engine`: transition maths (every kind starts on the
  old picture and ends on the new one, dip midpoint, wipes, clamping, luma
  patterns in range, iris covers the corners), scene graph (TAKE mid-fade,
  cut, dip, reveal on top, T-bar incl. cut-as-fade and wipe, stinger cut point,
  blank with its own fade length, PANIC, split boxes, graphics left to the
  overlay), placement (contain/cover/crop), sources (pattern delivers,
  no-signal after 1.5 s, recovery, files sized up to 4K, camera names), frame
  pool reuse, encoder arguments and a real FFmpeg encode (skipped without
  FFmpeg).
- `tests/gpu.rs`: offscreen renders read back (fade mixes, wipe halves, slide
  moves, blank/flash cover, contain pillarboxes, overlay over inputs, pipelined
  read-back one frame late, the whole
  engine with previews). Skipped with a note when there is no adapter; runs on
  llvmpipe on Linux CI; on Windows with `LUMORA_GPU_TESTS=1` (WARP), as the
  Studio engine's tests.
- Phase 2, `cargo test -p lumora-live-engine`: the graphics wire format
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
- Phase 2, more: the multiview layout (classic, both screens, inputs only,
  wrapping, the JSON the web side reads) and its drawing on the GPU (each
  tile's picture, tally borders, the words plane on top); group opacity (a
  split fading as one picture); green screen and brightness in the shader
  (pixels checked); JPEG and PNG pictures from the app's frame store and an
  input going live with them; the picture delay.
- Phase 3, `cargo test -p lumora-live-engine`: the vision wire format (same
  bytes as `visionWire.test.ts`, malformed refused), frames made small (NV12
  and RGB32), the shot moving as `stepShot` and its zoom and pan; the mask
  removing the background, a picture behind and portrait blur on the GPU,
  pixel by pixel; only inputs with the effects sent to the models; the
  stream's captions (a real FFmpeg feed: on the stream, not the recording or
  the screen); Next previews with their `n:` planes; the Monitor's plane and
  probe; the multiview's timecode planes in their boxes; the replay ring
  (pieces parsed, pruned, taken and copied) and a real replay: the engine's
  Live Screen into FFmpeg's segment muxer, a piece played back in slow motion
  as an engine source; videos following playback (paused, slow motion paced,
  ending without looping); slides and Pesukim with a camera behind.
- Phase 3, more (`cargo test -p lumora-live-engine`): an encoded picture
  copied into the file (a real FFmpeg: every frame, pieces of any size, a
  failing encoder ending the feed with its reason); zero-copy through the
  stand-in (the GPU ring, frames owed, the file's frames and colors, the
  route) and its fallback; Media Foundation's vendor names and the app's
  settings in its words; parameter sets found in a stream; graphics cards'
  keys and which card drives a display; an output copied to another device;
  HDR windows (scRGB and PQ values of SDR white, read back from `Rgba16Float`
  and `Rgb10a2Unorm`); HDR inputs (PQ and HLG maths, 10-bit RGB and P010 on
  the GPU against `hdr.rs`, a real HDR10 file told apart and decoded as 10-bit
  RGB); a camera as a slide fading in; the vertical version's shadow; a
  graphics input's multiview tile while not on air. `cargo clippy -p
lumora-live-engine --all-targets --target x86_64-pc-windows-msvc` checks
  `zerocopy_win.rs` and the DXGI and Media Foundation parts.
- Phase 3, vitest: `visionWire`, `visionWorker` (stand-in model: masks, aims,
  pictures behind sent once and again after a refusal), `engineCaptions`,
  `monitorWords` (layouts, fitting, flash, PANIC, the teleprompter),
  `overlayRenderer` (captions, Next, Monitor and timecode planes, stamps,
  slides leaving their background to the engine), `overlayPlanes`
  (`nextPlanes`, `multiviewPlanes`), `recorderUnified` (replay kept by the
  engine), `engineReport` (person finding; the zero-copy route, the engine's
  card and each window's card and colors).
- Phase 2, vitest: `overlayWire` (same bytes as Rust), `overlayDirty` (tiles,
  joining, bounding box, pacing, back-pressure), `overlayPlanes` (which planes
  at which sizes), `overlayRenderer` (the real compositor in graphics-only
  mode on a painting test canvas: a camera on air sends nothing and opens
  nothing; a graphic is sent once, then nothing until it changes, then
  cleared; a refused frame starts over), `recorderUnified` (recording,
  stream, vertical, NDI from the engine: no camera opened, the right mix
  tapped, lost encoders reported, replay refused), `engineTap`,
  `engineReport`.
- `npx vitest run app/src/engine/unified.test.ts`: the engine's health feeding
  the backup lineup (frames, stalls, failures with reasons, grace for a camera
  that is opening, inputs removed).
- `cargo clippy -p lumora-live-engine --all-targets --target
x86_64-pc-windows-msvc -- -D warnings` type-checks the Windows-only code
  (Media Foundation, Win32 windows) from Linux.

**On Windows hardware (before Unified leaves beta)**

1. Matrix: Windows 10 22H2 and 11 24H2; NVIDIA (desktop), AMD (desktop),
   Intel Iris Xe laptop, an Optimus laptop with HDMI on each GPU.
2. Inputs: 4 USB webcams (one 4K), one HDMI capture card, a video file, a
   picture. Unplug and replug each during a show: the backup lineup takes over,
   the input comes back by itself.
3. Outputs: Live and Back on two projectors, assigned and unassigned (windowed),
   150 % DPI on one; change the assignment live; Alt+F4 on a projector.
4. Every transition kind on TAKE and on the T-bar side by side with Standard
   (record both: frame-compare at 0/25/50/75/100 %); fade to black; PANIC.
5. `live-bench` and the Engine dialog's ms/frame: target < 4 ms/frame for the
   bench at 1080p on the Iris Xe laptop, 0 late frames over a 5-hour soak, flat
   memory (`FramePool::allocated` stays put).
6. Glass-to-glass latency with a flashing phone in front of a camera filmed
   next to the projector (240 fps phone video): target ≤ 3 frames.
7. "Test the engine's recording": file plays, 600 frames for 10 s at 60 fps,
   0 dropped, with each hardware encoder — and says "zero-copy: …" on
   NVIDIA, Intel and AMD (the GPU's encoder load in Task Manager, the
   engine's read-back time near zero); a 2-hour stream at 6 Mb/s with
   zero-copy, no drift between picture and sound.
8. Graphics cards: an Optimus laptop with the projector on each GPU, the
   engine automatic and on each card, each output "shown by its display's
   own graphics card" on and off (latency, late frames, the dialog's window
   list); a desktop with two cards.
9. HDR: an HDR10 display in HDR mode with an output in HDR (white at 203
   nits matches an SDR window beside it; graphics unchanged), an HDR10 and an
   HLG file, an HDR capture card in P010 (tone mapped, no clipping, no hue
   shifts); the same with the display in SDR (stays SDR).

## 7. Phases

- **Phase 0** — this document. ✅
- **Phase 1** — foundation behind the beta switch: crate, sources, frame
  pool, compositor with transitions/blank/PANIC/overlay slot, native windows,
  encoder feed, previews, health, benchmark. ✅ (Windows parts compile-checked
  from Linux; not yet run on Windows hardware.)
- **Phase 2** — done: the overlay renderer (a hidden window per screen
  drawing today's graphics code on transparent planes, dirty rectangles to
  the engine on change: Canvas + IPC chosen over Windows Graphics Capture,
  see "Graphics" above); stingers (the `top` plane); recording, streaming,
  vertical, NDI and ISO files from the engine with the WebView's sound mix as
  PCM (no camera opened by the control window); the test event in Unified
  mode; the multiview drawn by the engine in its own window; stream, web page,
  screen-capture and guest inputs; green screen and light and color in the
  shader (port of `chroma.ts`); the picture delay; group opacity; NV12 uploads
  and read-back; files with hardware decode; device-lost recovery. (Tested on
  Linux with llvmpipe and FFmpeg; the Windows-only parts — Media Foundation
  NV12, the native windows, WebView2's hidden renderers, D3D12 — compile-checked
  and still to be run on the Windows matrix of §6.) Left for later: background
  removal, blur behind people and auto-framing (the web's person model);
  captions written into the stream picture; instant replay; the Monitor as an
  engine window; graphics on the Next previews; frame-counting timecodes in
  the multiview; a camera behind slides or Pesukim words.
- **Phase 3** — done: background removal, blur behind people and
  auto-framing (the web's models in a hidden vision worker, masks and shots
  applied in the shader); captions written into the stream; instant replay
  from the engine's own frames (hardware-encoded pieces on disk) played as an
  engine input, with videos following the show's playback; graphics on the
  Next previews (only while seen); the Monitor in the engine's window;
  cameras behind slides and Pesukim words; multiview timecodes with frames.
  (Tested on Linux with llvmpipe and FFmpeg; the vision worker's models,
  WebView2's hidden windows, Media Foundation and the native windows still
  to be run on the Windows matrix of §6.) Then also: zero-copy encode (the
  engine's D3D12 texture shared with D3D11 and the vendor's Media Foundation
  hardware encoder, read-back fallback), the engine's graphics card and
  outputs shown by their display's own card, HDR outputs (HDR10/scRGB) and
  HDR inputs tone-mapped, a camera as a slide fading in, the vertical
  version's shadow, graphics inputs in the multiview while not on air, the
  replay's toggle following its encoder. (D3D12/D3D11/Media Foundation,
  DXGI's displays and HDR swap chains compile-checked; to be run on items
  7 – 9 of §6.) Left: running the Windows matrix, and Unified as the default.
