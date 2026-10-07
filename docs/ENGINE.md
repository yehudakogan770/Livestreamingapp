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
| Cameras               | `app/src/engine/cameras.ts` (`acquireCamera`)                                                                                                       | `getUserMedia` per **window**: the control window, each output window and the multiview each open every camera they show (shared inside a window, never between windows). Each copy is decoded and colour-converted separately.                                                                                                                                                                                           |
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

| Part             | File                                                                                                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Transition maths | `crates/live-engine/src/mix.rs`                                                                               | Line-for-line port of `mixOf`/`mixAt` (`timing.ts`) and `lumaValue` (`luma.ts`); same test cases as `timing.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                        |
| Scene graph      | `crates/live-engine/src/scene.rs`                                                                             | `program_scene` = `programLayers` + `ProgramView`: TAKE progress from `lumora_engine::timing::transition_progress`, T-bar (cut/stinger fade on the bar), stinger cut point, dip/flash, blank (its own fade length, e.g. fade to black), PANIC; reveal/zoom-out on top. Inputs → pictures: crop/zoom/pan/flip/rotate from `Adjust` (same maths as `chroma.ts`), contain/cover, split screens (PiP, side by side, grid, custom boxes); graphics inputs are marked for the overlay renderer. Pure; unit tested. |
| Sources          | `source.rs`, `mf.rs`                                                                                          | `VideoSource` trait; each source on its own thread, newest frame in a mailbox; health (starting / live / no signal after 1.5 s / failed, recovers on its own). Media Foundation camera (Windows; matched by name, Chrome's " (vid:pid)" dropped; ≤1080p, fastest mode; RGB32 via MF's video processor; retried every 2 s when unplugged). FFmpeg file/picture source (any OS). Test pattern.                                                                                                                 |
| Frame pool       | `frame.rs`                                                                                                    | Pixel buffers reused (one allocation per buffer size, tested).                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Compositor       | `gpu.rs`, `compose.wgsl`                                                                                      | One WGSL program: a quad per picture; shape (wipe rect, iris, diamond), luma wipe (patterns computed in the shader), blur, opacity, premultiplied "over"; bars around contained pictures drawn only outside the picture (so a fading picture never shows them through itself). Overlay layer per screen. Previews: every screen and input drawn small into one atlas, read back once.                                                                                                                        |
| Outputs          | `present.rs`                                                                                                  | Windows: borderless popup covering the assigned display (or a 960×540 window), `WS_EX_NOACTIVATE` (never takes focus from the control window), Alt+F4 ignored (an audience screen never closes by accident); wgpu surface, Mailbox/Immediate present (three displays never stall the engine on vsync); letterboxed.                                                                                                                                                                                          |
| Overlay renderer | `overlay.rs`, `app/src/engine/overlay{Renderer,Planes,Dirty,Wire}.ts`, `views/OverlayView.tsx`                | Graphics drawn by the recorder's Canvas code in a hidden window per screen, sent as dirty rectangles of planes, drawn by the engine in their place among the pictures (below).                                                                                                                                                                                                                                                                                                                               |
| Encoder feeds    | `feeds.rs`, `audio.rs`, `app/src/audio/engineTap.ts`                                                          | Recording, stream, vertical, NDI and ISO files at once, with the WebView's sound mix (below).                                                                                                                                                                                                                                                                                                                                                                                                                |
| Encoder feed     | `encoder.rs`                                                                                                  | Read back the Live Screen (pipelined: one frame late, never a stall) → raw RGBA into FFmpeg (wall-clock timestamps, CFR out; a frame FFmpeg can't take is dropped and counted, never queued without end) → encoded Matroska chunks → `capture.rs`'s normal recording/stream session (so files, destinations, reconnects and failure reporting are today's). Encoder arguments from `encode.rs` (hardware family picked as today).                                                                            |
| Engine loop      | `engine.rs`                                                                                                   | `LiveEngine::frame(now)` and `Runner` (own thread, fixed rate, catches a panicking frame and carries on).                                                                                                                                                                                                                                                                                                                                                                                                    |
| App glue         | `src-tauri/src/live.rs`                                                                                       | Mode saved in `live-engine.json`; `live_engine_info / set_mode / preview / health / test_record / graphics / audio / capture_start / capture_stop / probe`; `open_output`/`close_output` route Live/Back to the engine in Unified mode; the overlay renderer windows opened and closed with it (`sync_renderers`); show changes forwarded from `announce`.                                                                                                                                                   |
| UI               | `app/src/engine/unified.ts`, `components/EnginePreview.tsx`, `views/EngineDialog.tsx`, `views/engineHost.tsx` | Settings → Engine (how it is doing: frame time, late frames, graphics, encoding; what is not in it yet); in Unified mode `SourceView` shows cameras from the engine's previews (the WebView never opens them); `EngineHealthWatch` feeds `inputHealth` (the backup lineup) from the engine; recording and streaming go through the engine (`recorder.ts`); the test event runs with the engine answering for its screens.                                                                                    |

### Graphics: the overlay renderer (Phase 2)

Each engine screen (Live, and Back while the engine shows it) has a hidden
renderer window, `overlay-live` / `overlay-back`
(`app/src/views/OverlayView.tsx`, `app/src/engine/overlayRenderer.ts`;
opened by `live::sync_renderers`). It draws the screen's graphics with the
recorder's own Canvas code — `ProgramCompositor` in a **graphics-only mode**
(`compositor.graphicsOnly`, `drawPlane`): the same fonts, animations,
build-ons and show clock that recordings have today — into transparent
**planes**, and sends the engine only the rectangles that changed:

| Plane       | What                                                                                                                                                                                         | Drawn by the engine                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `g:<input>` | a graphics input (title, countdown, scoreboard, lyrics, slides, credits, stage visuals, 3D logo…) at the size it is shown: the whole screen, a split-screen box, or an overlay channel's box | in its own place among the pictures, with the transition's fade, wipe, slide, zoom, blur or luma wipe — exactly as a camera |
| `top`       | the stinger video                                                                                                                                                                            | over the overlay channels, under blank and PANIC                                                                            |
| `panic`     | the PANIC safe screen's logo                                                                                                                                                                 | over the engine's own PANIC black (which is instant, whatever the renderer does)                                            |

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
  darkened copy stretched up from a 48 × 27 target). FFmpeg is started and
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
  one has a soft shadow).

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

| Work                    | Cost                                                                                   | Note                                                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload 4 camera frames  | 4 × 8.3 MB RGBA = 2 GB/s over PCIe (≈ 15–20 % of PCIe 3 x16)                           | Phase 2: NV12 from MF (12 bit/px: 0.75 GB/s) converted in the shader (Studio's `yuv.rs` has it). On integrated GPUs uploads are memory copies. |
| Draw 3 screens + 2 Next | ~10 full-screen quads at 1080p ≈ 20 Mpx of simple fragments                            | < 1 ms on any discrete GPU; ~2 ms on Intel Iris Xe.                                                                                            |
| Present 2 windows       | blits                                                                                  | < 0.3 ms                                                                                                                                       |
| Encoder read-back       | 8.3 MB/frame = 500 MB/s download; pipelined (two buffers, one frame late), so no stall | Phase 2: NV12 on the GPU before read-back (190 MB/s); Phase 3: hand the D3D texture to NVENC/AMF/QSV directly.                                 |
| Previews                | one 1920×540 atlas read back 10×/s + JPEG of ~9 tiles                                  | ~1 ms every 6th frame                                                                                                                          |
| Engine CPU              | scene maths for 3 screens: **0.01 ms**; the rest is driver submission                  | Measured (below).                                                                                                                              |

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

| Run (load average)                                | ms / frame (avg / p95) | Of which                                               |
| ------------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| 1080p, 300 frames, synchronous read-back (≈ 10)   | 342 / 576              | upload 51, draw 64, outputs 156, encoder read-back 107 |
| 1080p, 150 frames, pipelined read-back (≈ 5)      | 149 / 185              | upload 26, draw 43, outputs 73, encoder read-back 5    |
| 640×360, 120 frames, synchronous read-back (≈ 10) | 88.7 / 131             | upload 30, draw 19, outputs 26, read-back 11           |
| 640×360, 120 frames, pipelined read-back (≈ 5)    | 53.7 / 66              | upload 26, draw 11, outputs 15, read-back 0.6          |
| 640×360 + FFmpeg x264 feed, 90 frames (≈ 10)      | 98.9 / 161             | 90 frames in, **0 dropped**                            |
| Scene maths, 3 screens (CPU only, any run)        | **0.01 ms**            |                                                        |

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
| HDR displays            | An 8-bit swapchain on an HDR desktop looks washed out or dim.                                                                                                                           | DWM composites SDR swapchains correctly on HDR desktops (sRGB → scRGB); we use `Bgra8Unorm`. A real HDR output (scRGB/`Rgba16Float`) is Phase 3.                                                                                                                                                                                                       |
| Hybrid-GPU laptops      | The engine picks the NVIDIA GPU (HighPerformance) while the projector's HDMI port hangs off the Intel GPU: every present is a cross-adapter copy; or Windows forces the integrated GPU. | wgpu reports the adapter (shown in the Engine dialog); test matrix includes Optimus/Advanced-Optimus laptops; Phase 2: pick the adapter that drives the most output displays (DXGI `EnumOutputs`), fall back to a per-output adapter.                                                                                                                  |
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
   0 dropped, with each hardware encoder.

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
  mode. Next: multiview drawn by the engine; NV12 uploads and read-back;
  stream/NDI/file inputs with hardware decode (`-hwaccel d3d11va`); chroma key
  and colour adjustments in the shader (port of `chroma.ts`); group opacity;
  device-lost recovery.
- **Phase 3** — zero-copy encode (D3D texture → NVENC/AMF/QSV), HDR output,
  per-output adapters, Unified as the default.
