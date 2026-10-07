# The unified engine

How Lumora draws its pictures today, the ways it could draw them once, which
one was chosen and why, and what is built so far. The code is
`crates/live-engine` (the engine), `src-tauri/src/live.rs` (the app's side)
and `app/src/engine/unified.ts` (the control window's side). It is switched
on in **Settings → Engine → Unified (beta)**; **Standard stays the default**
and is unchanged.

## 1. Today: every window draws its own copy

| Step                  | Where                                                                                                                                               | What it costs                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cameras               | `app/src/engine/cameras.ts` (`acquireCamera`)                                                                                                       | `getUserMedia` per **window**: the control window, each output window and the multiview each open every camera they show (shared inside a window, never between windows). Each copy is decoded and colour-converted separately.                                                                                                                                               |
| Screen windows        | `src-tauri/src/outputs.rs` opens a WebView window per screen; `app/src/views/OutputView.tsx` → `ProgramView` in `app/src/components/ScreenView.tsx` | Each Live/Back window lays out the screen as DOM: one `<video>` per input, transitions as CSS/Web Animations (`transitionKeyframes`, sampled from `mixAt` in `app/src/engine/timing.ts`), luma wipes as CSS masks (`app/src/engine/luma.ts`), graphics as React components (`OverlaysView`, `SourceView`). The WebView's compositor (WebView2 GPU process) puts it on screen. |
| Monitor               | `OutputView` → `MonitorScreen`                                                                                                                      | Words only; no cameras.                                                                                                                                                                                                                                                                                                                                                       |
| Multiview             | `app/src/views/MultiviewView.tsx`                                                                                                                   | Another set of `SourceView`s: another copy of every camera.                                                                                                                                                                                                                                                                                                                   |
| UI previews           | the control window's `ProgramView` / `PreviewView` / input tiles (`SourceView`)                                                                     | The control window's own camera copies.                                                                                                                                                                                                                                                                                                                                       |
| Recording / streaming | `app/src/broadcast/compositor.ts` (`ProgramCompositor`, 3 000+ lines)                                                                               | Draws the Live Screen **again** on a canvas with the same rules (`programLayers`), every graphic re-implemented in Canvas 2D; `captureStream` → `MediaRecorder` (WebView's encoder) → chunks over IPC → `src-tauri/src/capture.rs`, which writes files or pipes into FFmpeg (`src-tauri/src/encode.rs` picks NVENC / Quick Sync / AMF / x264).                                |

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
                 + overlay layer per screen (RGBA from the web, on change)
                      │             │                  │
     native windows (Live, Back)    encoder feed       preview atlas (10/s)
     present, never waits for vsync read back → FFmpeg  → JPEG tiles → control window
                                    → capture.rs (files, RTMP fan-out)
```

| Part             | File                                                                                                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Transition maths | `crates/live-engine/src/mix.rs`                                                                               | Line-for-line port of `mixOf`/`mixAt` (`timing.ts`) and `lumaValue` (`luma.ts`); same test cases as `timing.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                        |
| Scene graph      | `crates/live-engine/src/scene.rs`                                                                             | `program_scene` = `programLayers` + `ProgramView`: TAKE progress from `lumora_engine::timing::transition_progress`, T-bar (cut/stinger fade on the bar), stinger cut point, dip/flash, blank (its own fade length, e.g. fade to black), PANIC; reveal/zoom-out on top. Inputs → pictures: crop/zoom/pan/flip/rotate from `Adjust` (same maths as `chroma.ts`), contain/cover, split screens (PiP, side by side, grid, custom boxes); graphics inputs are marked for the overlay renderer. Pure; unit tested. |
| Sources          | `source.rs`, `mf.rs`                                                                                          | `VideoSource` trait; each source on its own thread, newest frame in a mailbox; health (starting / live / no signal after 1.5 s / failed, recovers on its own). Media Foundation camera (Windows; matched by name, Chrome's " (vid:pid)" dropped; ≤1080p, fastest mode; RGB32 via MF's video processor; retried every 2 s when unplugged). FFmpeg file/picture source (any OS). Test pattern.                                                                                                                 |
| Frame pool       | `frame.rs`                                                                                                    | Pixel buffers reused (one allocation per buffer size, tested).                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Compositor       | `gpu.rs`, `compose.wgsl`                                                                                      | One WGSL program: a quad per picture; shape (wipe rect, iris, diamond), luma wipe (patterns computed in the shader), blur, opacity, premultiplied "over"; bars around contained pictures drawn only outside the picture (so a fading picture never shows them through itself). Overlay layer per screen. Previews: every screen and input drawn small into one atlas, read back once.                                                                                                                        |
| Outputs          | `present.rs`                                                                                                  | Windows: borderless popup covering the assigned display (or a 960×540 window), `WS_EX_NOACTIVATE` (never takes focus from the control window), Alt+F4 ignored (an audience screen never closes by accident); wgpu surface, Mailbox/Immediate present (three displays never stall the engine on vsync); letterboxed.                                                                                                                                                                                          |
| Encoder feed     | `encoder.rs`                                                                                                  | Read back the Live Screen → raw RGBA into FFmpeg (wall-clock timestamps, CFR out; a frame FFmpeg can't take is dropped and counted, never queued without end) → encoded Matroska chunks → `capture.rs`'s normal recording/stream session (so files, destinations, reconnects and failure reporting are today's). Encoder arguments from `encode.rs` (hardware family picked as today).                                                                                                                       |
| Engine loop      | `engine.rs`                                                                                                   | `LiveEngine::frame(now)` and `Runner` (own thread, fixed rate, catches a panicking frame and carries on).                                                                                                                                                                                                                                                                                                                                                                                                    |
| App glue         | `src-tauri/src/live.rs`                                                                                       | Mode saved in `live-engine.json`; `live_engine_info / set_mode / preview / health / test_record`; `open_output`/`close_output` route Live/Back to the engine in Unified mode; show changes forwarded from `announce`.                                                                                                                                                                                                                                                                                        |
| UI               | `app/src/engine/unified.ts`, `components/EnginePreview.tsx`, `views/EngineDialog.tsx`, `views/engineHost.tsx` | Settings → Engine; in Unified mode `SourceView` shows cameras from the engine's previews (the WebView never opens them); `EngineHealthWatch` feeds `inputHealth` (the backup lineup) from the engine; the test event says it is not supported in Unified (beta).                                                                                                                                                                                                                                             |

### What Unified (beta) does not do yet

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
  and carries on, but doesn't rebuild the device yet.

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

| Work                    | Cost                                                                  | Note                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload 4 camera frames  | 4 × 8.3 MB RGBA = 2 GB/s over PCIe (≈ 15–20 % of PCIe 3 x16)          | Phase 2: NV12 from MF (12 bit/px: 0.75 GB/s) converted in the shader (Studio's `yuv.rs` has it). On integrated GPUs uploads are memory copies.  |
| Draw 3 screens + 2 Next | ~10 full-screen quads at 1080p ≈ 20 Mpx of simple fragments           | < 1 ms on any discrete GPU; ~2 ms on Intel Iris Xe.                                                                                             |
| Present 2 windows       | blits                                                                 | < 0.3 ms                                                                                                                                        |
| Encoder read-back       | 8.3 MB/frame = 500 MB/s download, ~1–2 ms stall (synchronous map)     | Phase 2: NV12 on the GPU before read-back (190 MB/s) and a two-buffer ring (no stall); Phase 3: hand the D3D texture to NVENC/AMF/QSV directly. |
| Previews                | one 1920×540 atlas read back 10×/s + JPEG of ~9 tiles                 | ~1 ms every 6th frame                                                                                                                           |
| Engine CPU              | scene maths for 3 screens: **0.01 ms**; the rest is driver submission | Measured (below).                                                                                                                               |

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

Measured on the development container (4 vCPU shared with other jobs, load
≈ 10, **no GPU: llvmpipe, Mesa's software rasterizer, through OpenGL**), so
every pixel is drawn by the CPU — these numbers are a floor for correctness and
an upper bound for cost, not a prediction for an event PC:

| Run                                   | ms / frame (avg / p95) | Of which                                               |
| ------------------------------------- | ---------------------- | ------------------------------------------------------ |
| 1080p, 300 frames                     | 342 / 576              | upload 51, draw 64, outputs 156, encoder read-back 107 |
| 640×360, 120 frames                   | 88.7 / 131             | upload 30, draw 19, outputs 26, read-back 11           |
| 640×360 + FFmpeg x264 feed, 90 frames | 98.9 / 161             | 90 frames in, **0 dropped**                            |
| Scene maths, 3 screens (CPU)          | **0.009 ms**           |                                                        |

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

| Risk                    | What could happen                                                                                                                                                                       | Plan                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Camera exclusive access | A camera opened by the engine (MF) and by a WebView (`getUserMedia` in the Standard recorder, Zoom/Teams) fails in one of them.                                                         | Windows 10 1809+ Frame Server shares most USB (UVC) cameras between processes; capture cards (Magewell, Elgato, Blackmagic) are often exclusive. Phase 2 moves the recorder onto the engine feed so Lumora opens each camera exactly once. The engine reports "being used by another program" and retries every 2 s. |
| DPI                     | Windows placed in logical pixels land wrong on a 150 % display.                                                                                                                         | The engine places windows in physical pixels from Tauri's monitor list (`outputs::displays`), and Tauri makes the process Per-Monitor-V2 aware, which the engine's own Win32 windows inherit.                                                                                                                        |
| HDR displays            | An 8-bit swapchain on an HDR desktop looks washed out or dim.                                                                                                                           | DWM composites SDR swapchains correctly on HDR desktops (sRGB → scRGB); we use `Bgra8Unorm`. A real HDR output (scRGB/`Rgba16Float`) is Phase 3.                                                                                                                                                                     |
| Hybrid-GPU laptops      | The engine picks the NVIDIA GPU (HighPerformance) while the projector's HDMI port hangs off the Intel GPU: every present is a cross-adapter copy; or Windows forces the integrated GPU. | wgpu reports the adapter (shown in the Engine dialog); test matrix includes Optimus/Advanced-Optimus laptops; Phase 2: pick the adapter that drives the most output displays (DXGI `EnumOutputs`), fall back to a per-output adapter.                                                                                |
| WebView2 GPU process    | Standard and Unified share the GPU: WebView2's GPU process (D3D11) and the engine (D3D12) contend; a driver reset kills both.                                                           | In Unified mode the WebViews draw much less (no camera video, no output windows). Device-lost recovery for the engine is Phase 2; the Standard engine is one switch away.                                                                                                                                            |
| Fullscreen and focus    | A popup over the projector steals focus or is minimised by a focus change; Alt+F4 closes the projector.                                                                                 | `WS_EX_NOACTIVATE`, never minimised, `WM_CLOSE` ignored; borderless popups covering a monitor get DWM's independent flip.                                                                                                                                                                                            |
| Antivirus / FFmpeg      | The FFmpeg pipe is slow or blocked.                                                                                                                                                     | Same FFmpeg the app already ships and probes (`capture::find_ffmpeg`); dropped feed frames are counted and shown.                                                                                                                                                                                                    |

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
  moves, blank/flash cover, contain pillarboxes, overlay over inputs, the whole
  engine with previews). Skipped with a note when there is no adapter; runs on
  llvmpipe on Linux CI; on Windows with `LUMORA_GPU_TESTS=1` (WARP), as the
  Studio engine's tests.
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
- **Phase 2** — the overlay renderer (one hidden WebView per screen rendering
  today's graphics components on a transparent background, frames to the
  engine on change via Windows Graphics Capture as `browser.rs` already does
  for web page inputs); recorder and stream on the engine feed with the
  WebView's sound mix piped as PCM; NV12 uploads and read-back; multiview drawn
  by the engine; stream/NDI/file inputs with hardware decode (`-hwaccel
d3d11va`); chroma key and colour adjustments in the shader (port of
  `chroma.ts`); stingers; group opacity; device-lost recovery.
- **Phase 3** — zero-copy encode (D3D texture → NVENC/AMF/QSV), HDR output,
  per-output adapters, Unified as the default.
