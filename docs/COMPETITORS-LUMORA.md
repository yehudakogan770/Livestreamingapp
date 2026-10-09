# Lumora against every comparable app

Researched October 2026 (vendor release notes, review sites, user forums).
The owner's goal: whatever any comparable app does, Lumora does too, done
more simply, plus things none of them have.

✅ Lumora has it · ◐ partly, or another way · ❌ not yet

Who has it, short names: **vMix** · **OBS** (with the popular plugins
Advanced Scene Switcher, Move, StreamFX, Aitum Vertical) · **WC** Wirecast ·
**EC** Ecamm Live · **SL** Streamlabs Desktop · **SY** StreamYard · **RS**
Restream Studio · **RV** Riverside · **PR** Prism Live Studio · **MM**
mimoLive · **TC** TriCaster · **ATEM** Blackmagic ATEM Software Control ·
**LS** Livestream Studio · **PP** ProPresenter · **RE** Resolume · **ST**
Stagetimer.io · **H2R** H2R Graphics · **SM** Slido / Mentimeter.

## Summary

|                          | Count |
| ------------------------ | ----- |
| ✅ Lumora has it         | 100   |
| ◐ Partly, or another way | 6     |
| ❌ Not yet               | 7     |

Built in this round (now ✅): marks while recording that Lumora Studio picks
up, triggers on sound level / lost picture / a video about to end / recording
or stream starting / every few minutes, event templates in the first setup,
Facebook live comments, speaker timing on the Monitor (amber, red, time over,
progress bar), find any command by typing (Ctrl+K), Twitch, Kick, LinkedIn
and X in the streaming list.

## The matrix

### Switching and scenes

| Feature                                               | Who has it                                    | Lumora                                  |
| ----------------------------------------------------- | --------------------------------------------- | --------------------------------------- |
| Preview / program, TAKE, CUT, T-bar                   | vMix, OBS (studio mode), WC, TC, ATEM, LS, MM | ✅                                      |
| Transitions (fades, wipes, pushes, zooms)             | all switchers                                 | ✅ 22 kinds                             |
| Stinger transitions with a cut point                  | vMix, OBS, WC, TC                             | ✅                                      |
| A transition per preset / scene                       | OBS (per-scene override), vMix                | ✅ presets carry their own transition   |
| Animated moves between layouts                        | OBS Move plugin, vMix, MM                     | ✅ split-screen layouts animate         |
| Layers inside an input (camera + logo + title as one) | vMix (10 layers), OBS scenes, MM              | ✅                                      |
| Overlay channels over everything                      | vMix (4), TC (DSKs), ATEM (DSKs)              | ✅ 4+ per screen                        |
| Several outputs with different pictures               | vMix, TC (M/E), PP                            | ✅ Live, Back and Monitor, built in     |
| Multiview                                             | vMix, TC, ATEM, OBS                           | ✅                                      |
| Fade to black, panic                                  | vMix, ATEM, TC                                | ✅ plus PANIC that never shows an error |
| Instant replay, slow motion, highlights reel          | vMix, TC, WC                                  | ✅                                      |
| Picture-in-picture, split screen, custom boxes        | all                                           | ✅                                      |
| Green screen, garbage mattes                          | vMix, OBS, WC, EC, TC, MM                     | ✅                                      |
| Virtual sets                                          | vMix, TC                                      | ✅                                      |
| Background removal without a green screen             | OBS (NVIDIA), PR, EC, SY                      | ✅ offline                              |
| Auto-framing a wide camera                            | EC (Center Stage), PR                         | ✅                                      |
| Color correction, LUTs, crop, rotate                  | vMix, OBS, WC, TC                             | ✅                                      |
| Video delay per input                                 | vMix, OBS (render delay)                      | ✅                                      |
| Auto camera switching (by time)                       | vMix, MM                                      | ✅                                      |
| Switching to who is talking                           | OBS (Advanced Scene Switcher audio), MM       | ✅ sound-level triggers (new)           |
| Drawing on screen live (telestrator)                  | vMix 28, TC                                   | ❌                                      |
| Vertical (9:16) version beside the wide one           | OBS Aitum Vertical, SY, RS, PR                | ✅                                      |

### Inputs

| Feature                                      | Who has it                               | Lumora                                                                |
| -------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| USB / capture-card cameras                   | all desktop apps                         | ✅                                                                    |
| Blackmagic DeckLink in and out               | vMix, OBS, WC, MM                        | ✅                                                                    |
| NDI in and out                               | vMix, OBS (plugin), WC, TC, MM, PP       | ✅                                                                    |
| SRT / RTMP / HLS stream inputs               | vMix, OBS, WC                            | ✅                                                                    |
| Phones as cameras                            | EC, PR, WC (Rendezvous), vMix (via apps) | ✅ unlimited, on the local network                                    |
| Remote guests by link                        | vMix Call, SY, RS, RV, EC, WC Rendezvous | ✅ up to 8                                                            |
| Green room for guests (wait before going on) | SY, RS, RV                               | ◐ a guest waits in the inputs until taken; no separate backstage chat |
| Screen and window capture                    | all desktop apps                         | ✅                                                                    |
| This computer's sound / one app's sound      | vMix 28, OBS                             | ❌                                                                    |
| Web page input with control                  | vMix, OBS, PP                            | ✅ back, reload, scroll, click                                        |
| Video playlists, show loops                  | vMix, PP, OBS (VLC source)               | ✅                                                                    |
| PowerPoint / PDF slides                      | vMix, PP, EC, WC                         | ✅                                                                    |
| PTZ camera control                           | vMix, TC, ATEM, MM                       | ✅ VISCA, saved shots                                                 |
| Control an ATEM switcher                     | Companion, vMix (scripts)                | ✅                                                                    |

### Graphics and titles

| Feature                                       | Who has it                    | Lumora                             |
| --------------------------------------------- | ----------------------------- | ---------------------------------- |
| Lower thirds, titles, tickers                 | all                           | ✅                                 |
| Animated title designer                       | vMix GT, WC, TC LiveText, H2R | ✅ Lumora Titler                   |
| Data-driven titles (CSV, Google Sheets, JSON) | vMix, H2R, TC DataLink        | ✅                                 |
| Scoreboards with game clock                   | vMix, H2R, WC                 | ✅                                 |
| Brand kit applied to every title              | SY, RS, EC                    | ✅ event look                      |
| Credits                                       | vMix, PP                      | ✅                                 |
| Countdown timers                              | vMix, H2R, ST, PP             | ✅ with actions at zero            |
| 3D logo animation                             | (none)                        | ✅ Lumora only                     |
| Song lyrics with next lines                   | PP                            | ✅                                 |
| Live chat comments on screen                  | SY, RS, SL, EC, vMix Social   | ✅ YouTube, Twitch, Facebook (new) |
| Alerts (follows, subscriptions, tips)         | SL, PR                        | ❌ (aimed at gaming streams)       |
| Beat-synced stage visuals                     | RE                            | ✅ 261 scenes, MIDI, tap tempo     |
| Captions (speech to text)                     | OBS (plugin), SY, RS          | ✅ offline                         |
| Teleprompter                                  | SY, EC, PP                    | ✅ on the Monitor, mirrored        |

### Stage and timing

| Feature                                 | Who has it  | Lumora                                                                             |
| --------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| Stage display / confidence monitor      | PP, ST      | ✅ Monitor output                                                                  |
| Messages to the speaker, flash          | ST, PP      | ✅                                                                                 |
| Timer that turns amber, then red        | ST, PP      | ✅ (new)                                                                           |
| Time over shown after zero (+1:05)      | ST          | ✅ (new)                                                                           |
| Progress bar of the time gone           | ST          | ✅ (new)                                                                           |
| Run of show with cues on the clock      | ST, PP, MM  | ✅                                                                                 |
| Speaker's own clicker from a phone      | PP (remote) | ✅                                                                                 |
| Timer and messages on a speaker's phone | ST          | ◐ the phone remote has a messages-only permission; no stand-alone speaker view yet |

### Audio

| Feature                                      | Who has it                          | Lumora |
| -------------------------------------------- | ----------------------------------- | ------ |
| Mixer with meters, mute, solo                | all                                 | ✅     |
| Audio follows video                          | vMix, TC                            | ✅     |
| EQ, gate, compressor, limiter, noise removal | vMix, OBS, WC                       | ✅     |
| Buses (stream, hall, recording)              | vMix (A–G), OBS (tracks)            | ✅     |
| Music ducking under speech                   | vMix, OBS (sidechain)               | ✅     |
| Loudness meter (LUFS) with targets           | vMix, OBS (plugin)                  | ✅     |
| VST plugins                                  | vMix, OBS, EC 4.4                   | ❌     |
| Each microphone recorded to its own file     | OBS (tracks), vMix (multitrack), RV | ✅     |

### Recording and streaming

| Feature                                               | Who has it                               | Lumora                                                           |
| ----------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| Record and stream at the same time                    | all desktop apps                         | ✅                                                               |
| Several destinations at once                          | vMix (5), RS (cloud), SY, EC (10), PR    | ✅                                                               |
| YouTube / Facebook accounts (no stream keys)          | SY, RS, EC, PR, SL                       | ✅                                                               |
| Twitch, Kick, LinkedIn, X, TikTok, Instagram          | RS, SY, PR, SL                           | ✅ (Twitch, Kick, LinkedIn, X added)                             |
| SRT and RTMPS out                                     | vMix, OBS, WC                            | ✅                                                               |
| Backup server per destination                         | vMix, OBS (YouTube backup)               | ✅                                                               |
| Automatic reconnect                                   | all                                      | ✅ recording never stops                                         |
| ISO recording of every camera                         | vMix, TC, ATEM, MM                       | ✅                                                               |
| Chapter markers                                       | ATEM (in DaVinci), vMix                  | ✅                                                               |
| Mark moments while recording, picked up by the editor | ATEM (markers in DaVinci), RV (clips)    | ✅ (new) to Lumora Studio                                        |
| AI highlight clips                                    | SY, RS, RV, OBS (plugin)                 | ◐ instant-replay highlights reel and marks; no automatic picking |
| Cloud recording copy                                  | SY, RS, RV                               | ❌ Lumora records locally (works with no internet)               |
| Simulated live (play a recording as live)             | SY, RS                                   | ✅ scheduled go-live and triggers                                |
| Scheduled go-live                                     | SY, RS, ST                               | ✅                                                               |
| Stream health and performance                         | vMix 28 (encoder stats), OBS (stats), SY | ✅ always-in-view chip                                           |
| Per-output size and frame rate                        | vMix, OBS (canvases)                     | ◐ wide and vertical; not every output sized separately           |
| Virtual camera (into Zoom or Teams)                   | OBS, vMix, EC, WC, PR                    | ◐ through NDI out with the free NDI Webcam                       |
| Zoom meeting as an input                              | vMix, EC, WC (coming)                    | ❌                                                               |

### Automation and control

| Feature                                        | Who has it                              | Lumora                         |
| ---------------------------------------------- | --------------------------------------- | ------------------------------ |
| Macros (steps with waits)                      | vMix, TC, ATEM, MM                      | ✅                             |
| Triggers: video ends, on air, countdown, clock | vMix, OBS (ASS), MM                     | ✅                             |
| Triggers: a few seconds before a video ends    | vMix 28 (OnPlaybackTime)                | ✅ (new)                       |
| Triggers: sound above / below a level          | OBS (ASS)                               | ✅ (new)                       |
| Triggers: input lost / back                    | OBS (ASS), vMix                         | ✅ (new)                       |
| Triggers: recording / stream starts or stops   | OBS (ASS)                               | ✅ (new)                       |
| Triggers: every few minutes                    | OBS (ASS)                               | ✅ (new)                       |
| Hotkeys for everything                         | vMix, OBS                               | ✅                             |
| Find any command by typing                     | (none)                                  | ✅ Ctrl+K, Lumora only (new)   |
| Stream Deck, Companion, MIDI, OSC, HTTP API    | vMix, OBS (websocket), ATEM, TC, PP, RE | ✅                             |
| Tally lights                                   | vMix, ATEM, TC                          | ✅ phone cameras and Companion |
| Web control from a phone                       | vMix web controller, ATEM, PP           | ✅ with per-device permissions |
| Several operators on several computers         | TC (LivePanel), vMix (remote)           | ✅ operator seats              |
| Rehearsal mode with a report                   | (none)                                  | ✅ Lumora only                 |
| Pre-show check of the computer                 | (none)                                  | ✅ Lumora only                 |

### Audience

| Feature                                         | Who has it              | Lumora         |
| ----------------------------------------------- | ----------------------- | -------------- |
| Polls from phones, results on screen            | SM, SY, RS              | ✅             |
| Q&A from phones                                 | SM                      | ✅             |
| Quiz with a leaderboard                         | SM (Menti quiz), Kahoot | ✅ trivia      |
| Messages wall                                   | SM, social walls        | ✅             |
| Word cloud, rating scales                       | SM                      | ❌             |
| Raffles, fundraiser, live auction, table finder | (none)                  | ✅ Lumora only |

### Ease and safety

| Feature                                                       | Who has it          | Lumora                                                        |
| ------------------------------------------------------------- | ------------------- | ------------------------------------------------------------- |
| Templates for kinds of events                                 | SY (studios), RS    | ✅ Conference, Concert, Wedding, Sports, Panel, Webinar (new) |
| Guided first setup                                            | EC, SY              | ✅                                                            |
| Crash-safe saving, reopens where it was                       | vMix (partly), PP   | ✅                                                            |
| Outputs keep going if the control window freezes              | TC (hardware)       | ✅                                                            |
| Never black by accident (holds the last frame, backup lineup) | ATEM (hardware)     | ✅                                                            |
| Manual inside the app, offline                                | (none)              | ✅                                                            |
| Works fully offline                                           | vMix, OBS, ATEM, TC | ✅                                                            |
| Windows and Mac                                               | OBS, WC, PP, RE     | ◐ Windows (Lumora Titler also runs in a browser)              |

## What users complain about, and Lumora's answer

**vMix.** The interface is dense and dated; the mixer takes too much room with
many inputs; feature requests wait for years; VST and a telestrator only in
recent versions or the top license; licenses priced by input count.
_Lumora:_ three screens with plain words, a mixer that folds away, everything
in one license, and Ctrl+K to find any command.

**OBS Studio (and plugins).** Hard for beginners (users can't find the chroma
key or the noise gate); automation, vertical, transitions and replay need
separate plugins that break on updates; no real preview/program habits, no
titles, no instant replay without workarounds.
_Lumora:_ all of it built in and tested together, a guided first setup with
templates, triggers in plain words (no plugin), and a manual in the app.

**Wirecast.** Subscription only now; expensive tiers for more guests and
multiview outputs; reports of crashes in long shows.
_Lumora:_ outputs keep running if the control window freezes, crash-safe
saving, everything in one license.

**Ecamm Live.** Mac only; one output; built for one person talking to a
camera.
_Lumora:_ Windows, three outputs (stream, projector, stage) from one
computer, and operator seats for a crew.

**Streamlabs Desktop.** Heavy on the processor, gets slower over long
streams, conflicts with other software, key features behind Prime.
_Lumora:_ the performance chip is always in view, the unified engine draws
on the graphics card, and nothing is behind an extra subscription.

**StreamYard / Restream Studio.** In the browser, so quality is capped (720p
on lower plans), price rises, no local control, needs the internet the whole
time, limited recording storage.
_Lumora:_ up to 4K, records locally (and every camera separately), works
with no internet, guests by link like theirs.

**Riverside.** Excellent recordings, but live shows are limited, and editing
lives in their cloud.
_Lumora:_ marks while recording and the event file open straight in Lumora
Studio with every camera and microphone lined up.

**Prism Live Studio.** Aimed at personal streams; effects over production
tools.
_Lumora:_ production tools first, effects where they help.

**mimoLive.** Mac only, priced per month at the high end.
_Lumora:_ Windows, one license.

**TriCaster.** Hardware costs tens of thousands; training needed.
_Lumora:_ replay, macros, data titles, virtual sets and a multiview on a
good PC.

**ATEM Software Control.** Controls the switcher only: no titles that come
from data, no streaming destinations of its own, no stage display.
_Lumora:_ controls the ATEM too (cut, auto, keyers, macros), and adds
everything around it.

**Livestream Studio.** The Livestream platform was shut down by Vimeo in
2025; the software lives on only inside Vimeo plans.
_Lumora:_ streams anywhere, no platform lock-in.

**ProPresenter.** Multi-display setups that drop screens, crashes when
moving presentations, subscription.
_Lumora:_ screens assigned once and remembered, never black by accident.

**Resolume.** Expensive, and only for visuals.
_Lumora:_ beat-synced stage visuals built into the same app that switches
the cameras.

**Stagetimer.io.** Runs in the browser and needs the internet for remote
devices.
_Lumora:_ the stage timer (amber, red, time over) works on the local
network with no internet.

**H2R Graphics.** A separate app beside vMix or OBS.
_Lumora:_ graphics, data and switching in one.

**Slido / Mentimeter.** Priced per event or per year; another tab to run.
_Lumora:_ polls, Q&A, trivia and messages from phones in the same app, on
the local network or the internet.

## What is left, and why

- **Drawing on screen (telestrator).** Needs a new kind of input drawn by
  every renderer (screens, recordings, the unified engine). Worth doing for
  sports and teaching; next in line.
- **This computer's sound / one app's sound.** Needs Windows WASAPI loopback
  capture in the native engine, which has to be built and tested on Windows
  hardware. Until then: a virtual audio cable shows up as a microphone input.
- **VST plugins.** Lumora's sound filters run in the app's sound engine; VST3
  hosting needs a native audio path with each plugin isolated so a crashing
  plugin can't stop the show, and testing on Windows with real plugins. The
  built-in filters (EQ, gate, compressor, noise removal, limiter, ducking)
  cover what event shows use.
- **Virtual camera.** A Windows virtual camera is a signed system component;
  it cannot be built or tested here. NDI out with the free NDI Webcam already
  feeds Zoom and Teams.
- **Cloud recording copy, AI clips, alerts, Zoom input, word clouds.** Either
  need an online service Lumora deliberately does without (it works offline),
  or fit gaming streams more than events. Word clouds belong with the audience
  pages and are on that list.
- **Per-output size, Mac version.** Larger engine work, tracked in
  FEATURES.md.
