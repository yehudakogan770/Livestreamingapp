### Graphics: the overlay renderer (Phase 2)

Each engine screen (Live, and Back while the engine shows it) has a hidden
renderer window, `overlay-live` / `overlay-back`
(`app/src/views/OverlayView.tsx`, `app/src/engine/overlayRenderer.ts`;
opened by `live::sync_renderers`). It draws the screen's graphics with the
recorder's own Canvas code — `ProgramCompositor` in a **graphics-only mode**
(`compositor.graphicsOnly`, `drawPlane`): the same fonts, animations,
build-ons and show clock that recordings have today — into transparent
**planes**, and sends the engine only the rectangles that changed:

| Plane         | What                                                                                                                                                                                             | Drawn by the engine                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `g:<input>`   | a graphics input (title, countdown, scoreboard, lyrics, slides, credits, stage visuals, 3D logo…) at the size it is shown: the whole screen, a split-screen box, or an overlay channel's box | in its own place among the pictures, with the transition's fade, wipe, slide, zoom, blur or luma wipe — exactly as a camera |
| `top`         | the stinger video                                                                                                                                                                                | over the overlay channels, under blank and PANIC                                                                          |
| `panic`       | the PANIC safe screen's logo                                                                                                                                                                     | over the engine's own PANIC black (which is instant, whatever the renderer does)                                         |

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
