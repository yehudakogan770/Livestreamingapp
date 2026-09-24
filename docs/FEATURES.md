# Lumora — Complete Feature List

Everything Lumora should or can do. It combines the author's notes (`SPEC.md`),
everything agreed during design (`../design/`), and the features a best-in-class
live-event app needs. How it is built is in `ARCHITECTURE.md`.

**Goal: the best live-event app available, and everything proven to work.**

### Priority

- **★ Core** — needed for the first real event. Built first.
- **◆ Pro** — makes Lumora better than the alternatives. Built right after core.
- **○ Future** — valuable extras once everything above is solid.

### Definition of done (applies to every feature)

A feature only counts as finished when **all** of these are true:

1. It matches the approved design (or an agreed change to it).
2. It has automated tests that run on Windows on every change.
3. It was tested on real hardware (real cameras, displays, phones).
4. It survives the failure cases listed for its area (unplugged device, lost
   Wi-Fi, full disk, crash and restart…).
5. It is explained in the how-to manual.

---

## 1. Screens and switching

- ★ Three outputs: **Live Screen** (stream), **Back Screen** (projector), **Monitor** (stage)
- ★ **Choose which screen you control** (Live / Back / Monitor, F1–F3); the whole work area follows
- ★ Screens assigned to physical displays once in Settings, remembered for every event
- ★ Preview and Program monitors per screen, with source name and resolution
- ★ **TAKE** plays the chosen transition; **CUT** switches instantly
- ★ **T-bar** that drags side to side, with a live crossfade, and stays where it lands (broadcast style)
- ★ Transitions: Cut, Fade, Merge, Dip to black, Wipe, Slide — duration adjustable per button
- ★ As many transition buttons as needed, each with its own type and length
- ★ Double-click an input to send it straight to air
- ◆ Stinger transitions (a video with alpha that plays over the switch)
- ◆ Transition preview on hover
- ◆ Same source on several screens at once, or different sources per screen
- ◆ Follow mode: Back Screen automatically mirrors the Live Screen until you break it off
- ○ Custom transitions (shape wipes, logo wipes)

**Proven by:** take/cut/T-bar timing tests (frame-accurate), transition render tests per type, 3-display hardware test.

## 2. Inputs and sources

- ★ **Cameras**: USB, HDMI/SDI through capture cards, all modes (resolution, frame rate) selectable
- ★ **Videos** with play, pause, seek, ±10 s, loop, speed — **usable while live**
- ★ **Images** and solid colours
- ★ Add as many inputs as needed; reorder, rename, colour-tag
- ★ Real picture thumbnails that update live on every input tile
- ★ Per-input audio on/off and volume
- ★ Warning (not black) when a source disconnects; auto-reconnect when it returns
- ◆ **Phone as camera** — unlimited phones over the local network; one tap turns the phone screen black except a small "back" button
- ◆ **Browser tab** source — show and control a web page (back, reload, scroll, zoom, interact)
- ◆ **NDI** input (network cameras and other computers)
- ◆ **SRT / RTMP** input (wireless and remote cameras)
- ◆ Screen / window capture (a PowerPoint, a second computer's output)
- ◆ PTZ camera control (pan, tilt, zoom, presets) for VISCA / NDI PTZ cameras
- ◆ Playlists (a list of videos that play in order)
- ○ Instant replay (last 10–60 s of any camera, slow motion)
- ○ Audio-only inputs (microphones, music player)

**Proven by:** capture-card matrix test, hot-unplug test, 5-hour playback soak, phone-camera reconnection test.

## 3. Auto controls

- ★ When a **countdown, 12 Pesukim, slideshow, credits or browser** goes on air, its controls open automatically above the inputs
- ★ They close when it leaves the air; can be dismissed with ×
- ◆ Every source type can define its own quick controls

## 4. Blank, panic and safety

- ★ Blank Back, Back + Live, or All
- ★ **Panic** on every page — double-click: all screens go black except the Monitor, which dims
- ★ Outputs keep running if the control window freezes or crashes
- ★ Never black by accident: failed sources hold their last good frame
- ◆ Safe mode: lock the main screen so nothing changes by an accidental click
- ◆ Undo the last action (Ctrl+Z) for anything that is not on air

## 5. Presets and cues

- ★ Presets: each shows only the inputs and buttons set up for it
- ★ Custom preset buttons that run several actions (e.g. "Vid 2 + Overlay 1 with a fade")
- ★ Add as many presets and buttons as needed
- ★ Next / previous preset (also from remotes and keyboard)
- ★ **Run of show / cues**: split the event into sections and cues
- ★ Start the event and cues fire **on the clock**, after the previous one ends, or manually
- ◆ Rehearsal mode: run the whole show without sending anything to the real screens
- ◆ Cue warnings ("next cue in 30 s") on the control screen and Monitor
- ○ Cue sheet import from a spreadsheet

## 6. Library

- ★ Everything made for an event (presets, texts, timers, slideshows, credits, loops, overlays) saved for later events
- ★ Categories and search
- ★ Export / import to move everything to another PC
- ◆ Sign-in sync between computers (works offline, syncs when online)
- ◆ Event templates ("Chanukah rally", "Dinner", "Conference")

## 7. Overlays

- ★ Any input can be an overlay; 4+ overlay channels per screen
- ★ Ready-made overlays (logo bug, lower thirds, scoreboard, confetti)
- ★ **On-the-spot overlay**: add to preview first, position it, then send to air; saved to the event
- ★ Video overlays turn off when they end (loop optional)
- ◆ Position, size, crop, opacity, animation in/out per overlay
- ◆ Data-driven lower thirds (names from a list)
- ○ Social media comments overlay

## 8. Split screen and layouts

- ★ Split-screen with 2–4 sources: side by side, picture-in-picture, custom boxes
- ★ Split-screen presets; change layout while live
- ◆ Borders, gaps, background, per-box crop and zoom
- ◆ Animated moves between layouts

## 9. Text and titles

- ★ Text on any screen, prepared before or typed on the spot
- ★ Formatting: font, size, colour, background bar, alignment, **Hebrew + English (right-to-left)**
- ★ Many fonts included, import your own
- ◆ Animated titles (fade, slide, typewriter)
- ◆ Scrolling ticker

## 10. Stage Monitor

- ★ Text only (no cameras or video) — for the people on stage
- ★ Ready-made messages + your own (saved for future events)
- ★ Current time clock and the countdown's time left (plain)
- ★ **Layouts with several things at once**, each area formatted separately
- ★ Flash to get attention
- ◆ Next cue / speaker notes area
- ◆ Speaker timer that turns amber then red
- ○ Hebrew date and zmanim (candle-lighting time)

## 11. 12 Pesukim

- ★ **One word at a time** — the child says it, the crowd repeats it
- ★ Next word (Space / clicker / remote), back a word, whole pasuk, next pasuk, blank
- ★ Word strip to jump to any word; next word always visible
- ★ Display modes: one word / word + pasuk bar / whole pasuk
- ★ Child's name per pasuk; words editable; hyphen joins two words
- ★ Backgrounds or camera behind; fonts, sizes, colours
- ◆ Auto-advance timing; videos between pesukim
- ◆ Presenter clicker support

## 12. Slideshow

- ★ PowerPoint, PDF and image slides
- ★ Slides on part of the screen with the camera behind / beside
- ★ Videos between chosen slides
- ★ Next / previous / go to slide from anywhere
- ◆ Automatic timing, transitions between slides

## 13. Hype countdown timer

- ★ Countdown to a time or for a length, on Back and Live screens
- ★ Add or remove minutes **while it is running**, including in the last 10 seconds
- ★ Dramatic final-10-seconds view
- ★ Styles, fonts, effects, background loops
- ★ Monitor mirrors the plain time left
- ◆ Sound effects for the final seconds
- ◆ Count up, and clock mode

## 14. Green screen and scenes

- ★ Chroma key with fine controls (similarity, smoothness, spill, edge, shadows)
- ★ Garbage mattes
- ◆ Full scenes with layers (backgrounds, foregrounds, props), not only a background
- ◆ Virtual sets
- ○ AI background removal (no green screen needed)

## 15. Back-screen loops

- ★ Ready-made loops (aurora, particles, warm glow …)
- ★ Energy, speed, brightness, tint controls
- ★ Follow the music (react to the beat and volume)
- ◆ Mood presets; import your own loops

## 16. Audio

- ★ Mixer with a fader and meter per input, plus master
- ★ Mute, solo, audio-follows-video
- ★ Real level meters (peak + hold)
- ◆ EQ, compressor, noise gate, limiter per input
- ◆ Audio delay per input (to sync with video)
- ◆ Separate audio mix for the stream vs. the room
- ◆ Auto-ducking (music lowers when someone speaks)
- ○ VST plugins

## 17. Video adjustments and effects

- ★ Per camera: brightness, contrast, saturation, white balance, sharpness
- ◆ Colour looks (LUTs), skin smoothing, black & white
- ◆ Crop, rotate, mirror, zoom
- ◆ Live effects on the stream (blur, vignette, glow)

## 18. Credits / thank-you list

- ★ Rolling credits, pages, or a name wall
- ★ Speed, pause, restart while live
- ★ Import names from a spreadsheet

## 19. 3D logo maker

- ★ Import a logo (PNG/SVG); depth, bevel, material, lighting
- ★ Motion: full spin, **back and forth** (width, ease / pause / bounce), float
- ★ Export any length as video (MOV with transparency, WebM, MP4)

## 20. Recording

- ★ Automatically records every event (MP4)
- ★ After the event: keep, export (format, quality, trim) or delete
- ◆ ISO recording: each camera recorded separately as well
- ◆ Disk-space checks before and during the event, with warnings
- ◆ Chapter markers at every cue

## 21. Streaming

- ★ Stream to several sites at once (YouTube, Facebook, custom RTMP/SRT)
- ★ Stream health: bitrate, dropped frames, connection status
- ★ Automatic reconnect if the internet drops
- ◆ **Lumora stream page**: each event gets a branded viewer page
- ◆ Backup stream / backup internet connection
- ○ Live captions (offline speech-to-text)

## 22. Remotes (phones and tablets)

- ★ Control everything from phones and tablets — works on any screen size
- ★ Phone layout: preset dropdown with next/prev, big TAKE, blank, more controls
- ★ Several devices at once, always in sync
- ★ **Security**: new devices must be approved on the PC (PIN / QR code)
- ★ If a remote disconnects, nothing on the screens changes; it reconnects by itself
- ◆ Permissions per device (full control, monitor messages only, camera only, view only)
- ◆ Second PC as an extra control screen or as an output only
- ◆ Stream Deck, MIDI controllers and keyboard shortcuts (all customisable)
- ○ Tally lights on phone cameras

## 23. Reliability and monitoring

- ★ Autosave everything continuously; reopen exactly where it was after a crash
- ★ Health bar: CPU, GPU, memory, dropped frames, disk, network
- ★ Clear warnings before problems (low disk, device lost, overheating)
- ◆ Event log (what happened when) for after-event review
- ◆ Pre-show check: tests every screen, camera, mic and stream before doors open

## 24. Settings and customisation

- ★ Simple mode and Advanced mode
- ★ Video quality settings (default highest)
- ★ Window mode that doesn't cover the taskbar, or full screen
- ★ Open the controls a second time on another screen
- ◆ Customisable layout (move, resize, hide panels) with reset to default
- ◆ English and Hebrew interface

## 25. Updates, manual and website

- ★ Works fully offline
- ★ Updates install automatically when online (never during a live event)
- ★ How-to-use manual with pictures, inside the app
- ◆ Product website (features, screenshots, download, private feedback)
- ◆ Guided first-time setup

## 26. Brand

- ★ Iris-blades logo; the lit blade follows the screen you control
- ★ Startup animation
- ★ Lumora's own font (chosen from the font boards)
