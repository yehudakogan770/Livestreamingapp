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
- ★ **All three at once** (F4): all three screens side by side, each with its basic controls — program and next-up pictures, TAKE, CUT, Blank, video play / pause / skip, every input one click away; the Monitor with its message, quick messages, flash and timer. Each has "Full controls" to jump into that screen
- ★ Screens assigned to physical displays once in Settings, remembered for every event
- ★ Preview and Program monitors per screen, with source name and resolution
- ★ **TAKE** plays the chosen transition; **CUT** switches instantly
- ★ **T-bar** that drags from the left with a live crossfade, stays where it lands mid-mix, and springs back to the left once the mix is complete
- ★ Transitions: Cut, Fade, Merge, Dip to black, Wipe, Slide — duration adjustable per button
- ★ As many transition buttons as needed, each with its own type and length
- ★ Double-click an input to send it straight to air
- ★ **Back = Live** switch: when on, whatever is on the Live Screen also plays on the Back Screen, with the same transitions; the Back Screen keeps its own blank; taking something on the Back Screen by hand turns it off
- ◆ Stinger transitions (a video with alpha that plays over the switch)
- ◆ Transition preview on hover
- ◆ Same source on several screens at once, or different sources per screen
- ○ Custom transitions (shape wipes, logo wipes)

**Proven by:** take/cut/T-bar timing tests (frame-accurate), transition render tests per type, 3-display hardware test.

## 2. Inputs and sources

- ★ **Cameras**: USB, HDMI/SDI through capture cards, all modes (resolution, frame rate) selectable
- ★ **Videos** with play, pause, seek, ±10 s, loop, speed — **usable while live**
- ★ **Images** and solid colors
- ★ Add as many inputs as needed; reorder, rename, color-tag
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
- ◆ Instant replay (last 10–60 s of any camera, slow motion) — see §27
- ○ Audio-only inputs (microphones, music player)

**Proven by:** capture-card matrix test, hot-unplug test, 5-hour playback soak, phone-camera reconnection test.

## 3. Auto controls

- ★ When a **countdown, 12 Pesukim, slideshow, credits or browser** is lined up in Next (or goes on air), its controls open automatically
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
- ★ Formatting: font, size, color, background bar, alignment, **Hebrew + English (right-to-left)**
- ★ Many fonts included, import your own
- ◆ Animated titles (fade, slide, typewriter)
- ◆ Scrolling ticker
- ◆ **Lumora Titler** (`titler/`): a motion-graphics designer for titles, lower thirds, scoreboards, tickers, full-screen cards and bugs — its own desktop app (Lumora-Titler-Setup.exe), a web app (docs/titler, works offline) and a window in Lumora and Lumora Studio, all one code base
  - Versioned `.lumtitle` projects (pictures and fonts inside): compositions and precomps, layers (text with inline styling, shapes and pen paths, pictures and SVG logos, videos and image sequences, groups, nulls), parenting, masks and track mattes, optional effects, user-chosen gradients
  - Keyframes with bezier easing (graph editor), motion paths, wipes, blur, text animators by letter/word/line; IN / HOLD / OUT markers and a loop; cue markers
  - Typed fields (text, number, color, picture, list) filled live by the operator from a generated control panel, or by Lumora's scoreboard, countdown, clock and data file; data sources (CSV, Google Sheets, JSON) with refresh; brand tokens take the event look
  - One renderer (Canvas 2D, deterministic in time) draws them in the designer, Lumora's screens, recordings and the unified engine's overlay renderer, and Studio's title clips; renders to ProRes 4444 with alpha, WebM with alpha, MP4 and PNG sequences
  - 24 starter templates in a plain broadcast style; the title library in Documents/Lumora/Titles is shared by the three apps
  - Audio cues: a cue marker's sound plays on air through Lumora's sound engine on the mixes chosen (Stream, Hall, Recording), on its frame, with Blank and PANIC; mixed into Studio exports; heard in the preview and in the Titler's own films
  - A title's own data sources on air in Lumora (read by the control window, rows chosen on the card and the graphics seat, Shift+[ / ] steps; sample < the title's data < typed < Lumora bindings)
  - Formats: the title in 9:16, 1:1, 4:5 and 4K made by layer constraints (pin, scale, stretch); on air the format closest to the picture's shape is drawn
  - Designer: RAM preview (frames made ahead, memory cap, green cached bar), resizable panels and four workspaces, the canvas on its own, recent titles, undo history and versions, notes pinned on the canvas, keyboard shortcuts sheet
  - Typography: font picker, tabular figures, kerning on/off, small caps, justify, baseline shift, shared text styles; shapes with a radius per corner, strokes inside/centered/outside and more outlines; Outline, Gradient overlay, Color correction and Grain effects; pro color picker with eyedropper and swatches
  - Animation: expressions (wiggle, loops, time, links to other layers), keyframes copied across layers, saved animation presets, stagger; frame-exact video layers in renders and Studio exports (WebCodecs)
  - Studio opens the designer in its own window; the Titler installer has its own header and sidebar pictures
  - **Proven by:** golden frames, format/migration, easing, layout, binding and packaging tests, designer component tests, a Titler overlay taken in and out in Lumora, a Studio title clip checked frame by frame; cue timing (frame-exact, loops, PANIC), cache invalidation, frame-exact decoding of a generated film (and in Chromium: e2e/titler-exact-video.mjs), data merge order, the Studio window round trip, expressions, formats, typography and effects on the pixels

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
- ★ **The 12 Pesukim built in** — Hebrew with nikkud, how each word sounds and what each word means, ready the moment the input is added
- ★ **Bar along the bottom** over the camera (or as an overlay): Hebrew, transliteration and English together, the word being said lit on all three lines
- ★ Bar designs (gold frame, royal blue, glass, night sky, simple dark), or **your own design** as a picture
- ★ Display modes: bar / one word / big word + line / whole pasuk
- ★ The child's name comes up **before** their pasuk (not the whole time); words editable; hyphen joins two words
- ★ Backgrounds or camera behind; fonts, sizes, colors
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

## 15. Stage visuals (beat-synced back-screen visuals)

Built from the Stage Visuals Live project (`modules/stage-visuals`).

- ★ 13 music types (Slow, Medium, Fast, Bounce, Electric, Acoustic, Worship, Hip hop, Rock, Latin, Retro 80s, Party & kids, Space) with 261 ready-made scenes on 60 animated looks
- ★ Beat clock: BPM, tap tempo, sync to 1; scenes change on the beat or the bar with automatic fades
- ★ Effect pads: strobe (hold), flash, blackout, freeze, invert, text, randomize, reset, colors, next scene
- ★ Quick visuals controls on the Back Screen strip and in the All-three view
- ★ Show on the Back Screen, the Live Screen, or both
- ◆ Advanced effects: zoom, spin, pan, zoom kick, mirror, kaleidoscope, hue, saturation, contrast, glow, trails, RGB split, pixelate, posterize, TV lines, vignette
- ◆ Overlay layer (a second scene blended on top) and text on screen with fonts and beat pulse
- ◆ Saved looks (scene + every effect setting); auto-change every N bars
- ◆ **MIDI keyboard control** (Yamaha PSR-SX720 first): learn mode maps keys to scenes, pads, looks, sliders — and to Lumora actions like TAKE and presets; MIDI clock sets the tempo
- ◆ Follow the music: react to the room's audio as well as the beat
- ◆ Import your own video loops alongside the generated visuals
- ○ Add your own scenes and color sets

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
- ◆ Color looks (LUTs), skin smoothing, black & white
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

- ★ Stream to several sites at once (YouTube, Facebook, custom RTMP, RTMPS or SRT)
- ★ Stream health: bitrate, dropped frames, connection status
- ★ Automatic reconnect if the internet drops (backing off 2 s → 30 s, “Reconnecting (3)…” on the LIVE button; the recording never stops)
- ◆ **Lumora stream page**: each event gets a branded viewer page
- ◆ Backup server per destination (YouTube's built in), switched to when the main one fails / ⬜ backup internet connection
- ○ Live captions (offline speech-to-text)

## 22. Remotes (phones and tablets)

- ★ Control everything from phones and tablets — works on any screen size
- ★ Phone layout: preset dropdown with next/prev, big TAKE, blank, more controls
- ★ Several devices at once, always in sync
- ★ **Security**: new devices must be approved on the PC (PIN / QR code)
- ★ If a remote disconnects, nothing on the screens changes; it reconnects by itself
- ◆ Permissions per device (full control, monitor messages only, camera only, view only)
- ◆ Second PC as an extra control screen or as an output only
- ◆ **Operator seats** (Settings → Operators… / Join a show on this network…): more people run one show from other computers on the venue network — Director, Graphics, Audio, Replay, Cameras or Custom seats, chosen and checked on the show computer; 6-digit pairing code, encrypted link, small previews and meters; a seat that drops never affects the show (`crates/seats`)
- ◆ Stream Deck, MIDI controllers and keyboard shortcuts (all customizable)
- ◆ Tally lights on phone cameras (and hardware tally, see §27)

## 23. Reliability and monitoring

- ★ Autosave everything continuously; reopen exactly where it was after a crash
- ★ Health bar: CPU, GPU, memory, dropped frames, disk, network
- ★ Clear warnings before problems (low disk, device lost, overheating)
- ◆ Event log (what happened when) for after-event review
- ◆ Pre-show check: tests every screen, camera, mic and stream before doors open

## 24. Settings and customization

- ★ Simple mode and Advanced mode
- ★ Video quality settings (default highest)
- ★ Window mode that doesn't cover the taskbar, or full screen
- ★ Open the controls a second time on another screen
- ◆ Customizable layout (move, resize, hide panels) with reset to default
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

---

## 27. Everything vMix has (parity checklist)

Rule: **any tool vMix has, Lumora has too** — built the Lumora way (simple
words, safe by default, tested). Items already covered elsewhere are listed
with their section; everything new is below them.

### Already planned elsewhere
Preview / program and TAKE / CUT / T-bar (§1, done) · transitions and stingers
(§1) · overlay channels (§7) · PiP and split screens (§8) · titles and tickers
(§9) · video lists and playlists (§2) · virtual sets and chroma key (§14) · NDI
input, PTZ control (§2) · per-input audio EQ, compressor, gate, VST (§16) ·
recording and ISO recording (§20) · streaming to several sites (§21) · Stream
Deck, MIDI, shortcuts (§22) · scoreboards (§9).

### Mixing
- ◆ **Multiview output**: every input plus preview and program on one extra
  screen, with names, red/green tally borders and audio meters; choose the layout.
- ◆ **Layers inside an input** (up to 10): e.g. camera + logo + lower third
  saved as one input and switched as one.
- ◆ **Color correction per input**: brightness, contrast, saturation, white
  balance, lift / gamma / gain; plus crop, zoom, position and rotate.
- ◆ **Four favorite transition buttons**, each with its own effect and length.
- ◆ **Quick play**: send one input to air with its own transition in one click.
- ◆ **Video and audio delay per input**, to line up cameras and sound.
- ◆ **Fade to black** with a chosen length (in addition to Blank and PANIC).
- ◆ **Snapshot**: save a still picture of any screen.

### Inputs
- ◆ **Screen capture**: this computer's screen or a single window, and other
  computers' screens over the network.
- ◆ **Stream inputs**: SRT, RTMP, HLS and web video links as live inputs.
- ◆ **Remote guests by link** (like vMix Call): up to 8 guests join from a
  browser; they see the show and hear a mix without their own voice.
- ◆ **Audio-only inputs**: music files and music playlists.

### Audio
- ◆ **Audio buses**: Master plus A–D, so the stream, the hall speakers and the
  recording can each get their own mix.
- ◆ **Audio follows video**: an input's sound comes up automatically when it
  goes on air and down when it leaves.
- ◆ **Headphone monitoring and solo**: listen to any input or bus privately.

### Outputs
- ◆ **NDI and SRT output** of each screen, to other computers and devices.
- ◆ **Virtual camera**: Lumora's program appears as a webcam in Zoom, Teams, etc.
- ◆ **Any resolution and frame rate per output** (up to 4K), with performance
  stats (CPU, GPU, render time, dropped frames).

### Replay
- ◆ **Instant replay**: keeps the last minutes of chosen cameras; replay any
  moment at normal or slow speed; mark highlights and play them as a reel.

### Automation and control
- ◆ **Triggers**: “when this happens, do that” — e.g. when a video ends, cut
  to Camera 1; when an input goes on air, show its lower third; at a clock time,
  start the countdown.
- ◆ **Macros**: a list of actions (with waits) run by one button, key, MIDI
  note or remote.
- ◆ **Web control and API**: control Lumora from any browser on the network,
  and from Bitfocus Companion, so Stream Deck, X-keys and other panels work.
- ◆ **Hardware tally lights** through Companion and network tally.
- ◆ **Data sources for titles and lists**: Excel / CSV / Google Sheets / RSS
  fill lower thirds, sponsor lists and credits automatically.
- ◆ **Animated title designer** with ready-made templates.
- ○ **Social media**: show chosen comments and questions from the stream on screen.

### Where Lumora already goes further than vMix
Three-screen control built in (Live / Back / Monitor) · stage monitor with
messages and countdown · hype countdown with actions at zero · 12 Pesukim ·
beat-synced stage visuals with keyboard control · Back = Live · simple words
everywhere · the audience never sees an error.


## 28. Everything the others have (market checklist)

Rule: **whatever any comparable app has, Lumora has too**, done more simply.
Compared: vMix, OBS Studio, Wirecast, ProPresenter, StreamYard, Restream Studio,
Streamlabs, Ecamm Live, Resolume, Blackmagic ATEM software, Zoom Events.
✅ = in Lumora now · 🔶 = partly there · ⬜ = still to build (in this order).

### Done
✅ Program / preview, TAKE, CUT, T-bar, 22 transitions (wipes and pushes every way, doors, circle, diamond,
zoom, blur, flash), 2 stingers with cut point, favorite transitions, Play now ·
✅ Fade to black · ✅ Overlays 1–4 with animations · ✅ Split screen / PiP / custom layers ·
✅ Titles, lower thirds, tickers in 6 designs with accent color and animated build-on · ✅ Credits · ✅ Countdown and stage monitor ·
✅ Slideshow (pictures, PDF) · ✅ Green screen · ✅ Color correction, crop, rotate, effects ·
✅ Web page input · ✅ Stream inputs (SRT / RTMP / RTSP / HLS) · ✅ 3D logo maker ·
✅ Beat-synced stage visuals · ✅ Recording and multi-site streaming · ✅ Snapshot ·
✅ Audio mixer with buses, follow video, solo, delay · ✅ Presets, run of show, triggers ·
✅ Screen capture (display or window) · ✅ Song lyrics with next lines on the stage monitor ·
✅ Audience polls from phones · ✅ PTZ cameras (VISCA) · ✅ Branding kit · ✅ Sound filters (EQ, gate,
compressor, noise removal) and a limiter on every mix · ✅ Sound from stream inputs ·
✅ Phone remote · ✅ Stream Deck / Companion web API and tally feed · ✅ MIDI learn for switching,
inputs, overlays, cues and sound · ✅ Video playlists · ✅ Scoreboards with game clock ·
✅ 720p – 4K, 30 / 60 fps and vertical 9:16 output, bitrates to 40 Mbps · ✅ Library · ✅ Multiview · ✅ Keeps imported files · ✅ Crash-safe saving.

### What uses the internet
Lumora works offline. Only these reach the internet, and only while they are in use:
live chat (while connected), guests by link (while a guest input exists), web page
inputs (the page itself), stream inputs from internet addresses, and streaming out.
The audience page (votes, questions, raffles, pledges, messages) can also be put on the
internet with one switch ("Anyone with internet"), through a free Cloudflare link — only
that page, never the operator's controls. Without internet, phones join the same Wi-Fi
(a travel router or a phone's hotspot works), and a "join the Wi-Fi" code can take turns
on screen with the page's code.

Signing in: each time Lumora or Lumora Studio starts with internet, the account is checked
again; without internet they open for up to 7 days after the last check. Two-step sign-in
(an authenticator app's code) is in My account, and the Lumora team's accounts must use it
(see docs/security-checklist.md).

### To build (most important first)
1. ✅ **Sound from stream and web page inputs** into the mixer.
2. ✅ **Screen capture** — this computer's screens or one window (OBS, vMix).
3. ✅ **Stream Deck / Companion control and an open API**, hardware tally (vMix, OBS, ATEM). HTTP + WebSocket with a token and OSC over UDP (docs/API.md); a Bitfocus Companion module (companion/) with tally feedbacks and presets; macros on the Stream Deck.
4. ✅ **Guests by link** (through VDO.Ninja, free, no account; ⬜ several guests in one room, mix-minus) — up to 8 people join from a browser, with their own
   mix-minus (StreamYard, Restream, vMix Call, Ecamm).
5. 🔶 **Live chat and comments on screen** from YouTube / Facebook / Twitch (StreamYard, Restream, Streamlabs). YouTube and Twitch done; ⬜ Facebook.
6. 🔶 **Audio filters** — noise suppression, noise gate, compressor, limiter,
   EQ per input, VST plugins (OBS, vMix). Done: low cut, EQ, gate, compressor, noise removal, limiter, per-input delay, LUFS loudness meter with −14 / −16 / −23 targets. ⬜ VST plugins.
7. ✅ **Instant replay** with slow motion (vMix, Wirecast), and a **highlights reel**: "Keep as a highlight" adds the last seconds to one video input that plays them all.
8. ⬜ **Virtual camera** and **NDI in / out** (OBS, vMix, Ecamm).
9. ✅ **Song lyrics and Bible library** with presentations, themes, stage display
   of the next lines (ProPresenter). Songs, next lines on the stage monitor, and all of Tanach (see 26).
10. ✅ **Video playlists / show loops** with auto-advance and shuffle (vMix, ProPresenter).
11. ✅ **Stingers** (a video transition with a cut point) (vMix, OBS).
12. ✅ **Scoreboards and timers** (vMix, Wirecast), and **data from spreadsheets**: a CSV or JSON file, or a Google Sheet link, read again as it changes; titles show {Column} values from the chosen row (next row by button, [ and ] keys, Stream Deck, phone, API or macro), and scoreboards can follow its columns (vMix data sources).
13. ✅ **Animated title designer** with templates (vMix GT, Wirecast) — 6 title designs with build-on, and a free-layout designer: text, boxes and pictures anywhere by dragging, each coming in its own way, with {Column} data.
14. 🔶 **Per-output resolution and frame rate**, performance stats (CPU, GPU, dropped frames). Stats done (processor, graphics card, memory, frames, dropped, data rates); ⬜ per-output size.
15. ✅ **ISO recording** — each camera recorded separately; chapter markers (vMix, ATEM).
16. ✅ **Branding kit** — logo, colors and fonts applied to every title at once (StreamYard, Restream).
17. ✅ **Audience polls and Q&A** shown on screen (Zoom Events, Restream).
18. ✅ **MIDI and keyboard mapping for everything**, not only visuals (vMix, Resolume).
19. ✅ **Video delay per input** to line up cameras with sound (vMix): each camera's picture can be held back up to 1 second (input settings → Crop & position), on every screen and in the recording.
20. ✅ **PTZ camera control** (vMix, ATEM).
21. ✅ **Raffles** — entries from phones or typed in, the draw on screen with the winner revealed.
22. ✅ **Fundraisers** — goal, total and donors on screen, pledges from phones (no payments taken).
23. ✅ **Messages wall** — messages, dedications and photos from phones; the operator lets each through (or all straight away) and they show one at a time, the newest six, or as a ticker over the picture (Slido, social walls).
24. ✅ **Live auction** — items one by one, bids from phones (one tap) or the room, the highest bid and bidder on screen, a countdown with extra time for late bids, "Sold!" and the total raised.
25. ✅ **Hebrew date and zmanim** — worked out offline for the event's city: the day's zmanim and special days on screen (card, bottom line, or a countdown to candle lighting); the stage monitor is told in the last hour; the stream and recording can end by themselves before Shabbos and Yom Tov.
26. ✅ **Tanach and Tehillim** — all of Tanach kept offline (Hebrew with nikkud and the 1917 JPS English, both public domain): any passage a verse at a time or whole, full screen or along the bottom; today's Tehillim (by the Hebrew date and the day of the week), often-said chapters, and finding words.
27. ✅ **Trivia game** — questions on screen with a timer, everyone answers from their phone (more points for quicker right answers), the right answer and how many chose each, and a leaderboard (Kahoot).
28. ✅ **Table finder** — the guest list pasted or opened from a spreadsheet (CSV); guests type their name on their phone and see their table (the whole list is never sent to phones); on screen, the code to scan or the list a page at a time.
29. ✅ **Teleprompter** on the stage monitor — the script scrolls past a reading line; the operator (or Stream Deck, or the phone remote) starts, pauses, speeds up and slows down; size and a mirrored picture for glass prompters.
30. ✅ **Music ducking** — music and videos get quieter by themselves while someone talks into a microphone, and come back up gently after (per channel, how much quieter is adjustable).
31. ✅ **Camera control** — a button per camera under Next (one click switches straight to it; red on air, green in Next); **Auto** goes through the chosen cameras by itself (in order or mixed up, a range of seconds, cut or quick mix) and waits while anything else is on air; each camera's zoom, pan, tilt, focus, light and color from the computer, with saved shots to go back to in one click.
32. ✅ **12 Pesukim bar over the Live screen** — as an overlay, so the cameras keep switching underneath; one word at a time or the line with the word lit (per event); whole pasuk with how it sounds and its translation; designs, your own picture, or no background with two-color words.
33. ✅ **Event look, fully customizable** — ready-made looks in one click; font (any installed font, or your own font files), size, thickness, italic, capitals, colors, outline, shadow, letter and line spacing, the second line's own color, size and font; box design, color, see-through, accent, corners, room, border; where name titles go and how they come on (build, fade, slide, rise, pop).
34. ✅ **How to use Lumora** — a plain-language manual inside the app (Help menu), searchable, offline: every part of the app step by step.
35. ✅ **500 built-in fonts** — all open-source (Google Fonts), 58 with Hebrew, kept inside the app so they work offline; a font picker with search and groups (Hebrew, sans, serif, display, handwriting, mono, on this computer, added), each font shown in itself; used by titles, songs, credits, the title designer and the 12 Pesukim, on screen and in the recording.
36. ✅ **On-screen effects** — 14 ways for titles to come on (build, fade, slide, rise, drop, pop, zoom, flip, focus, wipe, typewriter, bounce, spin, shine), for every title or the whole event look; the 12 Pesukim bar has its own entrance and an effect for each new word; the same on the screens and in the recording.

---

## 29. Lumora Studio (the editor): against the other editors

Compared with DaVinci Resolve, Premiere Pro, Final Cut Pro, Avid, CapCut,
Descript, Riverside, Opus Clip / Vizard / Submagic, Camtasia, Filmora,
Shotcut, Kdenlive and LumaFusion; the full table, the complaints and Studio's
answers are in `COMPETITORS-STUDIO.md` (65 of 78 tools ✅, 6 ◐, 7 ❌).

- ✅ **Finish the event** — one step: cameras cut by who is talking, speech written down, captions, chapters, a highlight reel, framed and captioned clips for social, everything queued and the event published to YouTube (private) when exported
- ✅ **Multicam from separate files** — lined up by sound, timecode or recording time; recorders as the sound
- ✅ **Clips for social** — ranked stand-alone moments on whole sentences, each its own vertical sequence framed on the speaker, with captions that light up word by word (seven tasteful looks)
- ✅ **Rough cut from a script** — every line found in the transcripts, the best take in order, other takes on hidden tracks
- ✅ **Transcript** — who is speaking at each change of voice (by microphone), filler sounds deleted at once
- ✅ **Mixer** — EQ, dynamics and limiter on every track, buses, the whole mix's processing and level, recorded fader moves; match loudness across clips; record a voiceover
- ✅ **Color** — stills and a reference wipe; drawn masks; rounded shape masks
- ✅ **Library** — 37 video transitions, 42 picture effects (video noise reduction, skin smoothing, clarity, tint, duotone, cinematic bars, mirror, tilt-shift, lens distortion, camera shake…), 45 motion title templates plus the Titler's
- ✅ **Publish to YouTube** — resumable upload with chapters, thumbnail and captions; the channel connection shared with Lumora
- ⬜ Still to come: animated drawn masks, HDR and color management, a voice model for single-microphone speakers, publishing to other platforms, client review links
