# Lumora — Architecture & Quality Plan

This file records the decisions that every part of Lumora must follow.
The product spec is in `SPEC.md`; the approved screen designs are in `../design/`.

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

### Rules

1. **One source of truth.** The show state lives in the engine. The UI sends
   actions and renders the state it receives; it never owns show state.
2. **The engine never waits on the UI.** Video output runs on its own threads.
   A frozen or crashed UI must never freeze or blank an output.
3. **Never go black by accident.** If a source fails, outputs hold the last good
   frame and the UI shows a clear warning.
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

1. Project foundation: app shell, CI, tests, empty Lumora window with branding.
2. Engine core: show state, the three outputs on chosen displays.
3. Sources: cameras / capture cards, video files, images, colours.
4. Switching: preview / program, TAKE, CUT, T-bar, transitions.
5. Monitor (text, clock, timer) and hype countdown.
6. Audio mixer.
7. Recording and streaming.
8. Presets, library, save / open events, crash recovery.
9. Phone and tablet remotes.
10. Remaining screens from `design/` (loops, pesukim, slideshow, credits,
    overlays, green screen, 3D logo, split screen, browser source).
11. Installer, auto-update, rehearsal / soak testing, release.
