# Lumora — Architecture & Quality Plan

This file records the decisions that every part of Lumora must follow.
The product spec is in `SPEC.md`, the full feature list with priorities and the
definition of done is in `FEATURES.md`, and the approved screen designs are in `../design/`.

## Goal

A professional, offline-first Windows app that runs live events across three
screens (Live Screen, Back Screen, Monitor) with the reliability of broadcast
software. When quality and speed of development conflict, quality wins.

## Architecture

| Layer | Technology | Responsibility |
|---|---|---|
| App shell | **Tauri 2** | Windows app, installer, windows, auto-update |
| Control UI | **React + TypeScript (strict)** | Every screen in `design/`, remotes |
| Engine | **Rust** | Everything that touches video, audio or timing |
| GPU compositing | **wgpu → Direct3D 12** | Mixing, transitions, overlays, keying, outputs |
| Capture | **Windows Media Foundation** (NDI later) | Cameras and HDMI capture cards |
| Media files | **FFmpeg, hardware decode** | Video, loops, images; seek while live |
| Audio | **WASAPI** | Low-latency mixing, meters, per-output routing |
| Record / stream | **FFmpeg with NVENC / Quick Sync / AMF** | MP4 recording, RTMP streaming |
| Outputs | Native full-screen windows per display | Live, Back, Monitor — frame-accurate |
| Remotes | Local web server in the engine (LAN only) | Phone / tablet control, no internet needed |
| Stage visuals | Stage Visuals renderer (`modules/stage-visuals`), WebGL first, ported to wgpu later | Beat-synced back-screen visuals, MIDI keyboard control |

### Rules

1. **One source of truth.** The show state lives in the engine. The UI sends
   actions and renders the state it receives; it never owns show state.
2. **The engine never waits on the UI.** Video output runs on its own threads.
   A frozen or crashed UI must never freeze or blank an output.
3. **The audience never sees an error.** If a source fails (camera unplugged,
   file missing or broken), that screen shows clean black and only the control
   window shows the warning. If an output window itself breaks, it goes black at
   once and reloads; the show lives in the engine, so it resumes exactly where
   it was. (Operator's choice: black rather than a frozen last frame.)
4. **Everything is recoverable.** The show autosaves continuously; after a crash
   or restart Lumora reopens exactly where it was.
5. **Offline first.** Nothing needed to run an event may depend on the internet.
6. **Designs are the spec for UI.** Screens match `design/` unless a change is
   agreed first.

## Quality gates (every change)

- Automated tests: engine unit tests (Rust), UI tests (TypeScript), end-to-end
  tests of key flows (take, transitions, timer, presets, monitor text).
- Strict type checking and linting (TypeScript strict, `clippy -D warnings`).
- GitHub Actions builds and tests on Windows and publishes a test installer.
- No change merges with a failing check.

## Performance targets (measured on the event PC)

- TAKE / CUT responds within one frame.
- 1080p60 on all outputs with 4 live cameras + 2 videos, zero dropped frames.
- Glass-to-glass camera latency under 3 frames.
- Memory flat (no growth) across a 5-hour soak test.
- Recording + streaming together use the GPU encoder, not the CPU.

## Delivery — milestones

Each milestone is tested on real hardware before the next one starts.

1. Project foundation: app shell, CI, tests, empty Lumora window with branding. **Done.**
2. Engine core: show state, the three outputs on chosen displays. **Done** (outputs
   render in their own windows; the wgpu renderer replaces the web renderer later).
3. Sources: cameras / capture cards, video files, images, colours. **Done** (web
   renderer; capture-card formats and hardware decode arrive with the native renderer).
4. Switching: preview / program, TAKE, CUT, T-bar, transitions. **Done.**

Until the native renderer lands, outputs are drawn by the web view: every window
computes transitions and video positions from the show and the shared clock
(`app/src/engine/timing.ts`, mirroring `crates/engine/src/timing.rs`), so all
screens stay in step. In a plain browser the UI runs on a demo engine
(`app/src/engine/demo.ts`) with the same rules, for design work and UI tests.
`LUMORA_SMOKE_TEST=1` starts the app, opens all three outputs and exits 0 if
they opened.
5. Monitor (text, clock, timer) and hype countdown. **Done.**
6. Audio mixer. **Done** (web audio engine: channels, three mixes, solo, speakers per mix; native WASAPI engine later).
7. Recording and streaming. **Done** (first version: REC / GO LIVE on the bottom bar,
   Settings → Recording and streaming. `app/src/broadcast/compositor.ts` draws the
   Live Screen onto a canvas (same rules as the output windows, no window needed);
   the WebView's MediaRecorder encodes it with the Stream mix; chunks go to
   `src-tauri/src/capture.rs`, which writes the recording as it arrives (then
   remuxes to .mp4) or pipes it into FFmpeg for RTMP to several destinations at
   once. Dropped streams reconnect by themselves. The native renderer will later
   replace the canvas and share one encode between recording and streaming.)
8. Presets, library, save / open events, crash recovery.
9. Phone and tablet remotes. **Done** (first version: Settings → Phone remote.
   `src-tauri/src/remote.rs` serves `src-tauri/remote/` on the local network with
   a 4-digit PIN; phones get every change live by Server-Sent Events and send
   actions through the same engine. Only show-running actions are accepted.
   Per-device permissions come later.)
10. Remaining screens from `design/` (stage visuals, pesukim, slideshow, credits,
    overlays, green screen, 3D logo, split screen, browser source).
    12 Pesukim: **done** (a `pesukim` input: `crates/engine/src/pesukim.rs`,
    `app/src/engine/pesukim.ts`, `PesukimView`, `PesukimCard`, `PesukimEditor`;
    Hebrew fonts bundled with @fontsource so they work offline).
    Overlays: **done** (four channels in `Show.overlays`, `crates/engine/src/overlays.rs`:
    input, box, opacity, animation in/out, auto-hide, screens, on air / in Next;
    `OverlaysView` animates them with the Web Animations API; the recorder draws
    them too; buttons 1 – 4 under the On air picture, Shift+1 – 4, the phone).
    Text and titles: **done** (a `text` input: lower third, title, ticker,
    full-screen message; font, weight, colour, outline, shadow, box; `TextView`,
    `TextEditor`, drawn by the recorder too).
    Credits: **done** (a `credits` input: rolling, pages or a wall of names;
    paste from a spreadsheet; play/pause/speed/restart live; rolls from the top
    when taken to air).
11. Installer, auto-update, rehearsal / soak testing, release.
