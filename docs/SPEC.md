# Lumora — Full Specification

> Compiled from all handwritten note pages (pen set, pencil set, small "directions" set, and loose pages).
> The pages were not in order and many were loose notes; everything has been sorted into sections below.
> **Every detail from the notes is included.** Where pages disagree, both versions are kept and marked **⚠ Conflict**.
> Where a page ran off the edge or was unclear, it is marked **❓ Unclear**.
>
> Note from the author: *"All images are what I envisioned it to look like — it does not have to match the images."*
>
> **Not every note is for this app.** Some pages from other programs were mixed in by mistake (e.g. the "stage cue" / singer page). Anything that doesn't fit should be flagged, not built.
>
> **Numbers are not final.** Counts in the notes and sketches (how many presets, cameras, videos, overlays, split screens, transitions, custom buttons, mixer sliders, etc.) were drawn on the spot and are **examples only**. The app should let the user **add as many as needed** (configurable, not fixed). What matters is the *kind* of control, not the exact number.

**Name:** Lumora (see §31).

---

## Table of Contents
1. [Overview](#1-overview)
2. [Directions for building the app](#2-directions-for-building-the-app)
3. [Platform & general requirements](#3-platform--general-requirements)
4. [Look & feel](#4-look--feel)
5. [Main event screen layout](#5-main-event-screen-layout)
6. [The three screens (outputs) & screen tabs](#6-the-three-screens-outputs--screen-tabs)
7. [Go Live popup & output windows](#7-go-live-popup--output-windows)
8. [Inputs / sources](#8-inputs--sources)
9. [Preview, Live, transitions & playback](#9-preview-live-transitions--playback)
10. [Blank screen & panic button](#10-blank-screen--panic-button)
11. [Presets](#11-presets)
12. [Library](#12-library)
13. [Cues & automatic run of show](#13-cues--automatic-run-of-show)
14. [Overlays](#14-overlays)
15. [Split screen](#15-split-screen)
16. [Text system & monitor messages](#16-text-system--monitor-messages)
17. [Fonts](#17-fonts)
18. [12 Pesukim preset](#18-12-pesukim-preset)
19. [Slideshow](#19-slideshow)
20. [Timer system](#20-timer-system)
21. [Green screen](#21-green-screen)
22. [Back-screen video loops](#22-back-screen-video-loops)
23. [Audio & video controls, effects](#23-audio--video-controls-effects)
24. [(Removed) Songs / singer page](#24-removed-songs--singer-page)
25. [End-of-event: thank-you list / credits](#25-end-of-event-thank-you-list--credits)
26. [3D logo maker](#26-3d-logo-maker)
27. [Live streaming](#27-live-streaming)
28. [Recording & export](#28-recording--export)
29. [Remote control: phones & tablets](#29-remote-control-phones--tablets)
30. [Connection, reliability & security](#30-connection-reliability--security)
31. [Name & logo](#31-name--logo)
32. [Settings, modes, customization & saving](#32-settings-modes-customization--saving)
33. [Offline use & automatic updates](#33-offline-use--automatic-updates)
34. [How-to-use manual](#34-how-to-use-manual)
35. [Product website](#35-product-website)
36. [Conflicts & open questions](#36-conflicts--open-questions)
37. [Technical notes (from Claude)](#37-technical-notes-from-claude)

---

## 1. Overview

- A **customized "vMix"** — a program for controlling screens at events.
- It controls, **all in one app**:
  1. The **live stream** ("live screen")
  2. The **screen behind the stage** ("back screen")
  3. The **monitor screen for the people on the stage** ("monitor")
- It is **controlled with presets**, but can **also be controlled live** for last-minute changes.
- It can be **remote-controlled from another device** — and by **multiple devices linked together**.

## 2. Directions for building the app

(Instructions to the AI building it.)

- Build it as a **proper app for Windows**. **Teach me how to do it properly — all the computer details.**
- **Build all the important stuff first**, and **everything has to work perfectly without any glitches**.
- **Always recheck the app / code for bugs** (underlined — "always").
- **Maybe first make it only in Claude and then code it as an app, OR make it as an app right away — only if there is a way for me to see how it looks and test it as we make it.**
- **Make a proper logo** — either tell me how it should look and I will make it, or make it yourself, but **I have to approve it**.
- **If you have questions, continue building the other parts of the app while waiting for my answer.**
- It should work simply but **also have very advanced controls — even stuff I did not tell you.**
- **Make a good professional name for it (max 2 words).**
- **I want a full, easy-to-understand guide for how to use the app.**

## 3. Platform & general requirements

- It should be an **app for PC, not a website**, so I don't have to risk using WiFi.
- Built as a proper **Windows** app.
- **Video quality has to be the highest**, but there should be **settings to control all of this**.
- **The quality has to be very high.**
- **The app should still work even when it's not connected to the internet.**
- **It should be easy to use but very advanced.** / **Very advanced but easy to use.**
- **It should not be overly complicated to use.**
- **It should be made to be set up before the event, but also still be able to be used easily without setup.**
- **It should be safe from all problems that can happen.**
- **When the app is open it should NOT cover the taskbar** (at the bottom of the screen) — **but there should be an option to make it full screen.**
- **I should be able to open the app in my computer a second time for a second screen of controls.**

## 4. Look & feel

- **Professional look**; a **full professional / studio look**.
- **Professional broadcast-console concept (like vMix) but with Lumora's OWN style — not a copy of vMix**, and *not* sci-fi or "hacker" style. Clean and uncluttered — achieved through layout, grouping and sizing, **never by removing controls** (every control must stay; it is for live events and must be fast). No yellow sliders. Proper console controls: real-looking faders with level meters, clean flat controls, input tiles with title strips, a transitions column with a T-bar — not plain sliders. (Clarified by the author.)
- **It is made for live events, so everything will be dark** — make it so that **whatever does not have to be bright is not bright**.
- **All times that a page other than the main page is open, it should be a popup with an [X] to close it.**
- **The layout should be customizable, but it should come already set up.**
- **It should be customizable** (in general).

## 5. Main event screen layout

Three sketches of the main screen exist. They agree on the main idea; details differ.

### Common elements (all sketches)
- **Menu** button (top-left)
- **Library** button
- **Add Preset** button
- **Preset grid** (2 columns, numbered)
- **Screen tabs:** `Live Screen` | `Back Screen` | `Monitor`
- **Go Live** button (top-right)
- **Preview screen** (left) with **▶ play / ⏸ pause** and a **progress/scrub bar**
- **Live screen** (right, larger) with **▶ play / ⏸ pause** and a **progress/scrub bar**
- **Fader** (T-bar slider) between preview and live
- **Transition buttons** (Fade 1, Fade 2, …)
- **Custom buttons:** Button 1, Button 2, Button 3
- **Blank Screen** button
- **Source grid:** Camera 1, Camera 2, Vid 1, Vid 2, Vid 3, Overlay 1, Overlay 2, Overlay 3, Split Screen 1, Split Screen 2
- **General mixer** (bottom-right): one volume slider per input + a master volume slider

### Sketch A — pen, page 1 (most detailed)
- Top bar: `Menu`, then tabs `live screen | back screen | monitor`, then `go live` at far right.
- Left column: `Library`, `Add Preset`, then **Presets 1–12** (2 columns × 6 rows).
- Center: **Preview screen** with ▶⏸ and scrub bar; below it the **Fader**.
- Right: **Live screen** with ▶⏸ and scrub bar; **Blank screen** button under the live screen at right.
- Under the preview/fader: **Fade 1, Fade 2, Fade 3** (row 1) and **Fade 4, Fade 5, Fade 6** (row 2).
- Next to fades: **Button 1, Button 2, Button 3**.
- Source grid: **Camera 1, Camera 2, Vid 1, Vid 2, Vid 3** (row 1); **Overlay 1, Overlay 2, Overlay 3, Split Screen 1, Split Screen 2** (row 2).
- **General mixer**: 4 horizontal sliders + 1 vertical master slider.

### Sketch B — pencil notebook ("main event screen")
- Top bar: `Menu` … `Blank Screen` | `Live Screen` | `Back Screen` | `Monitor` | `Go Live`.
  - Here the **Blank Screen button sits in the tab row, top-left of the preview.**
- Left: `Library`, `Add Preset`, **Presets 1–14** (2 columns × 7 rows).
- Column next to presets: **Button 1, Button 2, Button 3** (vertical).
- Preview with ▶⏸ + scrub bar; Live with ▶⏸ + scrub bar.
- **Transitions grid, 8 buttons:** `Transition 1`, `Fade 2`, `Merge 3`, `4` (row 1) / `5`, `6`, `7`, `8` (row 2).
- Source grid: **Camera 1, Camera 2, Video 1, Video 2, Video 3** / **Overlay 1, Overlay 2, Overlay 3, Split Screen 1, Split Screen 2**.
- **General mixer**: sliders, a row of **4 knobs/dials ("0000")**, and a vertical master slider.

### Sketch C — pen, page 3 (simpler layout)
Drawn right after *"on the phone it should be a more simple version — it should still be able to control everything"*, so this is **probably the phone / simple layout** (❓ Unclear — could also be a simplified main screen).
- `Menu`; **Presets 1–10**; tabs `live screen | back screen | monitor | go live`.
- Preview (▶⏸) and Live (▶⏸) side by side.
- **Fade 1, Fade 2** only.
- **Button 1, 2, 3**; **Blank Screen**.
- **Camera 1, 2; Vid 1, 2, 3; Overlay 1, 2, 3; Split Screen 1, 2.**
- **No general mixer** shown.

## 6. The three screens (outputs) & screen tabs

- The three outputs: **Live Screen** (the stream), **Back Screen** (behind the stage), **Monitor** (for the people on stage).
- **The Monitor is for communicating with the people on stage. It shows text and similar information only (messages, clock, countdown, flash) — not cameras, videos or the live picture.** (Clarified by the author.)
- **You select which screen you are controlling at that time** (Live Screen / Back Screen / Monitor). The whole work area — preview, program, inputs and controls — switches to that screen. This selector is the centre of the design. (Emphasised by the author.)
- **You can select which screen you want to see on your preview screen** (via the tabs).
- **The controls change per view screen.** Example: **the Monitor screen will have more controls for text and a button to flash the screen on the stage**, etc.
- **In settings you choose which screens are what before the event, so you don't have to do it each time.** / **Selecting which screens are what only needs to be done once.**

## 7. Go Live popup & output windows

- When you press **Go Live**, it opens a **popup page with a few controls and settings**.
- **It can also be opened mid-event.**
- Popup contents (sketch):
  - Title area: **"Controls for the live screens"**
  - **"(Select what you want opened)"** with checkboxes: **☐ Live Screen**, **☐ Back Screen**, **☐ Monitor**
  - **Go Live** button
  - **[X] Close** (top-right)
- **Whatever you select to open opens as a new tab/window that you drag to the screen you want it shown on.**
- Pencil version adds: **"this has to be set up before the event."**
- **If I need to use a second device only as an output, it should be very simple to do.**

## 8. Inputs / sources

- **Take multiple camera inputs: HDMI, USB, and wireless** ("all camera imports").
- **Phone as camera:** I can connect a phone and use it as one of the cameras — **I should be able to connect unlimited amounts of phones.**
  - **After you set up the phone camera and connect it to the system, you press a button on the phone and the whole phone screen turns black, except for a small button to go back to the camera controls.**
- **Videos** (Vid 1, 2, 3 … up to Vid 6 in the Add Preset popup).
- **Chrome tab / browser:**
  - **Be able to show a Chrome tab and use it in the app.**
  - **Show a Chrome tab in the app and control it from the app.**
  - **Make sure that connecting to a browser and showing a browser on the screen works without glitches or delays.**
- **Slideshow** (see §19).
- **Each input has its own audio control (on/off and volume).**
- **I should be able to select any import as an overlay** (see §14).

## 9. Preview, Live, transitions & playback

- **Preview screen** — where you set things up before sending them live.
- **Live screen** — what is currently showing.
- **Play / pause** on both preview and live, with a progress bar.
- **Fader** (T-bar) to move preview → live manually.
- **Transitions:** Fade 1–6 (pen) / Transition, Fade, **Merge**, and 5 more slots — 8 total (pencil).
- **Presets can trigger transitions** (e.g., "plays Vid 2 with Overlay 1 with a fade-in transition").

## 10. Blank screen & panic button

- **Add a button to make the screen go blank.**
- **I should be able to blank just the stage screen, or the stage screen and live screen.**
- **Panic button on all pages:** a button on every page to make the screen blank — **double-click it** and **all the screens go blank except the monitor, which just dims.**

## 11. Presets

- The app is **controlled with presets**, but can also be controlled live.
- **When you press a preset it only gives/shows you the inputs (whatever) you set up for that preset.**
- **In each preset you can have different buttons that do different things** (e.g., **"plays Vid 2 with Overlay 1 with a fade-in transition"**).
- **All presets I make should be saved in a library so I can reuse them and edit them.**
- **When you press "Add Preset", it opens a popup to create the (new) preset.**

### Add Preset popup (sketch)
- **[Search in library]** field (top-left)
- **[X] Close** (top-right)
- **Presets 1–20** list (2 columns × 10 rows) on the left
- Large area: **"(different controls and settings)"**
- **Button 1** and **[Add new +]** (to add custom buttons)
- Sources to include: **Camera 1, Camera 2, Camera 3, Vid 1, Vid 2, Vid 3, Vid 4, Vid 5, Vid 6, Overlay 1, Overlay 2, Overlay 3, Split Screen 1, Split Screen 2, Slideshow**
- **[Create Preset]** button (bottom)
- Side note: **"Library is organized into categories."**

### Built-in presets
- **12 Pesukim** preset (see §18).
- **Split-screen presets** (see §15).

## 12. Library

- **All presets are saved in a library** to reuse and edit.
- **Library is organized into categories.**
- **Search in library.**
- **Anything I make for an event I should be able to save and use for later events.**
- Songs also go into a library (see §24).

## 13. Cues & automatic run of show

- **In addition to cues and presets, I want to be able to start the event and, on a clock, each thing plays automatically.**
- **I should also be able to break up the event into a few cues.**

## 14. Overlays

- **Advanced system for overlays.**
- **I should be able to select any import as an overlay.**
- **It should have ready-made overlays.**
- **On-the-spot overlay:** an option to add something as an overlay mid-event **but only to the preview**, so I can put it how I want it, **and then add it to the main screen**.
  - Pencil adds: **it should be saved to the event.**
- **Video overlays:** there should be an **option to make it loop**, but **the default is that it turns off after the video ends.**

## 15. Split screen

- **Split-screen option for when I want 2 things playing together** (e.g., 2 cameras).
- **Split-screen control that I can also use mid-event.**
- **Split-screen presets.**
- Two split-screen slots on the main screen (Split Screen 1, 2).

## 16. Text system & monitor messages

- **Putting text on a screen should have an advanced system** that I can use **to set them up before events** and **do it on the spot during events**.
- **Monitor screen:** text only — used to communicate with the people on stage. Controls for text + **a button to flash the screen on the stage** (plus clock / countdown).
- **For putting text on the monitor screen, I can either use a ready-made message or type my own, and messages I type myself get saved for future events.**

## 17. Fonts

- **It should come with a ton of fonts, and I should be able to import my own.** (Stated twice.)

## 18. 12 Pesukim preset

- **A very advanced system / custom built-in preset for the 12 Pesukim.**
- **A bar on the bottom of the page where the text goes.**
- **It should come with a few background options**, and **the imported text goes on top of it.**
- **I should be able to format the text how I want it to be.**
- **I should be able to edit this preset how I want it per event.**
- **A button to go back and forth on the slides, and skip to a certain slide number.**
- **A place to put in the words, and anything else I might want.**
- **Slideshow with camera behind + videos between certain slides** — the example given for this was the 12 Pesukim (see §19).

### 12 Pesukim control layout (sketch — "an idea of what it should look like")
- **Regular buttons** (left):
  - Camera 1, Camera 2, Camera 3, Vid 1, Vid 2 (row 1)
  - Vid 3, Vid 4, Overlay 1, Overlay 2, Split Screen 2 (row 2)
- **Custom controls** (right):
  - **Next / Prev** buttons
  - **Go to [ slide # ]** box
  - **Background color ☐** checkbox
  - **(and other controls)**

## 19. Slideshow

- **Be able to play a slideshow, and behind it will be the camera, and between certain slides will be certain videos** (e.g., for the 12 Pesukim).
- Pencil version: **play a slideshow on part of the screen, and the rest of the screen will be the camera, and between [slides,] certain videos.**
- Slideshow is a source in the Add Preset popup.

## 20. Timer system

- **Add a system for putting a timer on the screen.**
- **A few ready-made loops for the background.**
- **Multiple fonts and effects that I can add.**
- **I should be able to add minutes if I want while it's playing on the main screen.**

## 21. Green screen

- **It should be able to use green screens.**
- **Very advanced system for green screens.**
- **Green-screen settings should be very advanced and have a lot of settings.**
- **I should be able to create full scenes, not just put a background behind it.**

## 22. Back-screen video loops

- **The app should come with ready-made video loops for the back screen.**
- **It should have a lot of manual and automatic controls to make it fit the vibe and the music.**

## 23. Audio & video controls, effects

- **Each input has its own audio control (on/off, volume).**
- **General mixer** with per-input sliders, knobs, and master.
- **Advanced audio controls.**
- **Advanced video controls.**
- **Camera settings:** it should have settings to control on the camera import **all the settings you have in a video-editing app for editing: colors, lighting, etc.**
- **Effects to add to the live stream.**

## 24. (Removed) Songs / singer page

- The page titled *"add to stage cue"* (song spreadsheet import, playlists, view-only singer page) **belongs to a different program (Stage Cue)** and was mixed in by mistake. **It is not part of this app.**

## 25. End-of-event: thank-you list / credits

- **Creating a thank-you list and these types of stuff for the end of events.**

## 26. 3D logo maker

- **A feature where I can import a logo and it will make it look 3D and rotating**, and **I should be able to export it in a video format, however long I want it to be.**

## 27. Live streaming

- **Make sure the live streaming works with no delays** and **connects to the screen and the live-streaming platform.**
- **I should be able to livestream it on all streaming sites at one time, from in the app.**
- **The app should have its own website for live streaming, and it can be customized to all the graphics of that event.** Make sure it all works without problems.
  - (i.e., a viewer page for each event's stream, branded with that event's graphics.)

## 28. Recording & export

- **It should automatically record all events, and after the event ask if I want it or if it should be deleted.**
- **It records the full event as a video — MP4 file.**
- **It should have export settings for after an event — I can choose settings for exporting it.**

## 29. Remote control: phones & tablets

- **Able to be controlled by a phone or tablet which is connected to the computer.**
- **Controlled by multiple devices, all linked together** (find the best way — guaranteed no fail).
- **On the phone it should be a more simple version, but it should still be able to control everything.**
- **The phone control version should work well for a small touch screen, but still be able to control everything.**
- **For the remote format of the app, it should work for any size screen (phone, iPad).**
- **For the phone version:** rather take out stuff, so then make it all smaller — so it's not too small but still has all the main controls.
  - e.g., **take out the preset list but keep it as a dropdown button, and have a button to go to the next preset and back to the previous one.**
  - **It should also have a way to access other hidden controls I might want.**
- **For the phone and iPad version it should be a website — not an app — unless there is a simple way to make it a proper phone app** (unless I can make it simple and fast). (Stated twice.)

## 30. Connection, reliability & security

- **How phones/iPads connect:** **the computer creates a WiFi network that the phone connects to, and each device works as an extender for the WiFi (for the next device).** (Stated on two pages.)
- Pencil: **the main device creates a WiFi that all the other devices connect to.**
- **Make sure the devices that are connected never glitch and disconnect.**
- **Make sure the devices always stay connected, and there are no delays or glitches** — *"in my other programs I had this problem."*
- **Make sure it's safe, and people can't just connect and start controlling it.**
- **It should be safe from all problems that can happen.**

## 31. Name & logo

- **A good professional name, max 2 words.** — **Chosen: Lumora** (lumen + Hebrew "ora", light).
- **A proper logo** — I either describe it and you make it, or you make it; **must be approved by me.**

## 32. Settings, modes, customization & saving

- **Simple mode and Advanced mode, which you can choose in settings.** (Stated twice.)
- **Customizable**; layout customizable but comes set up.
- **Settings to control video quality** (default highest).
- **Choose which screens are what** in settings, once.
- **Save my presets and settings so I can transfer them from one device to another.**
- **A sign-in system so your presets transfer automatically from device to device.**
- **Anything I make for an event can be saved and used for later events.**
- **Option to go full screen** (default: don't cover the taskbar).

## 33. Offline use & automatic updates

- **The app should still work even when it's not connected to the internet.**
- **Every time the app/device is connected to the internet, if there is an update available, it automatically updates.**
- **Make a way for me to put out updates.**

## 34. How-to-use manual

- **In the menu there should be a "how to use" manual.**
- **A full, easy-to-understand guide for how to use the app.**
- **Also make a how-to-use manual with images.**

## 35. Product website

(Page titled *"website for live streaming app"*.)
- **Make a website for my live-streaming app. It should be like all websites for apps:**
  - **What the app is**
  - **Features**
  - **Why this app**
  - **A place for comments that only I see**
  - **Explore the app** — talks about how the app works
  - **Screenshots of the app**
  - **A place to download it**
  - **And everything else the website should have.**

## 36. Conflicts & open questions

| # | Topic | What the notes say | Proposed resolution |
|---|-------|--------------------|---------------------|
| 1 | Counts of presets / sources / transitions / buttons | Differ between sketches (e.g. 10/12/14/20 presets) | **Not a real conflict** — numbers are examples only. Everything is add-as-many-as-you-need; phone uses dropdown + next/prev |
| 2 | Go Live popup timing | "can also be opened mid-event" vs. pencil "has to be set up before the event" | Screen assignment set up once before (saved in settings); popup can be reopened anytime |
| 3 | Transitions | Fade 1–6 (pen) vs. Transition / Fade / Merge + more (pencil) | Customizable transition buttons (add as many as needed); built-in types include Cut, Fade, Merge/Dissolve, Wipe, etc. |
| 4 | Blank Screen position | Under live screen (pen) vs. top tab row (pencil) | Both reachable; plus panic button on all pages |
| 5 | Phone remote: website vs. app | "Website unless there's a simple way to make it a proper app" | Installable web app ("Add to Home Screen") — no app store needed |
| 6 | "Each device is a WiFi extender" | Not possible on phones (see §37) | Dedicated offline travel router or PC hotspot |
| 7 | Sign-in sync vs. offline | Needs internet to sync | Local-first: works offline, syncs when online; manual export/import too |
| 8 | Streaming "no delays" | Platforms add delay | Local outputs instant; stream latency minimized ("low latency" modes) |
| 9 | Name | — | **Lumora** (decided) |

## 37. Technical notes (from Claude)

These are recommendations, not part of the author's notes.

- **App technology:** Electron (desktop app for Windows built with web technology). Lets us publish clickable previews while building, and the same code becomes the Windows installer. Heavy video work (recording, streaming, encoding) via FFmpeg; green screen and effects via GPU (WebGL) shaders.
- **Cameras:** HDMI via capture card and USB cameras appear as standard video devices. Wireless cameras via NDI / SRT / RTMP. Phone cameras via WebRTC over the local network.
- **Local network:** phones cannot act as WiFi extenders for another device's hotspot (iPhones in particular cannot). Most reliable: an **offline travel router** (~$30–60) that the PC and all devices join — no internet, no venue WiFi. PC hotspot is the fallback.
- **Reliability:** output windows run independently of controllers — if a phone disconnects, the screens keep playing. Controllers auto-reconnect and resync state.
- **Security:** new devices must be approved on the PC (QR code / PIN) before they can control anything; output-only and camera devices get limited permissions.
- **Streaming:** multistream to several platforms at once via RTMP/SRT; requires enough upload bandwidth for each destination.
- **Updates:** auto-update from a release server (e.g., GitHub Releases) when online; publishing an update = building a new version and uploading it.
- **Scale:** this is the scope of a full professional product; it will be built in stages, core first:
  1. Core mixer (preview/live, inputs, transitions, blank/panic, 3 output windows)
  2. Presets + library
  3. Phone/tablet remote + security
  4. Overlays, split screen, text, slideshow, 12 Pesukim, timer
  5. Green screen & video/audio controls
  6. Recording, export, streaming
  7. Thank-you list, 3D logo
  8. Sign-in sync, auto-updates, manual, website
