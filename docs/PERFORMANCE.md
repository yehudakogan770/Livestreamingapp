# Performance

## Website and Planner

How fast the website (`docs/`) and Lumora Planner (`planner/`, built into
`docs/planner`) load on a phone on a slow network, what was changed for it, and
how to keep it that way.

### How it was measured

- Lighthouse 12, mobile (Moto G-class screen), simulated **Slow 4G** (150 ms
  round trip, 1.6 Mbit/s) and **4x CPU slowdown**: median of 5 runs.
- `docs/` served locally with gzip and `max-age=600`, like GitHub Pages.
- Signed-in Planner views use a mocked account server (a plan with 11 cues and
  7 plans); "repeat visit" is a second visit with the service worker and the
  browser cache warm.
- Typing (Interaction to Next Paint) measured in Chromium at 4x CPU slowdown on
  a plan with **500 cues** and a chat with 400 messages, typing 11 letters.
- TBT varied a lot from run to run on the shared test machine (website: 21 to
  1350 ms for the same build), so treat it as noise; the other numbers were stable.

### Before and after

| Page                              | LCP           | FCP           | CLS             | Transferred  | JS           | Requests |
| --------------------------------- | ------------- | ------------- | --------------- | ------------ | ------------ | -------- |
| Website (home)                    | 3.46 → 2.04 s | 2.61 → 0.76 s | 0.023–0.049 → 0 | 547 → 344 KB | 6 → 7 KB     | 14 → 13  |
| Planner, sign-in                  | 2.78 → 2.07 s | 2.24 → 1.76 s | 0 → 0           | 237 → 205 KB | 160 → 143 KB | 9 → 9    |
| Planner, plans list (first visit) | 3.53 → 2.89 s | 2.77 → 1.74 s | 0.007 → 0.007   | 240 → 208 KB | 160 → 143 KB | 25 → 25  |
| Planner, a plan (first visit)     | 4.17 → 3.60 s | 2.77 → 1.80 s | 0 → 0           | 253 → 236 KB | 160 → 163 KB | 48 → 42  |
| Planner, a plan (repeat visit)    | 1.76 → 1.51 s | 0.79 → 0.17 s | 0 → 0           | 16 → 13 KB   | 0 → 0        | 41 → 42  |

The website's pictures are encoded at high quality (AVIF 80, WebP 92, JPG 92,
full color resolution) so they stay as sharp as the original JPGs; the bytes
saved come mostly from phones getting a picture sized for their screen.

Planner, second visit with a slow account server (every request 2 s): the plans
list is on screen after **0.28 s** (was 8.9 s), and the fresh list replaces it
at 2.7 s.

Typing, 4x CPU slowdown (worst / 75th percentile of the keystrokes):

| Where                             | Before        | After        |
| --------------------------------- | ------------- | ------------ |
| Computer, a cue's title, 500 cues | 600 / 424 ms  | 296 / 224 ms |
| Phone, a cue's sheet, 500 cues    | 264 / 88 ms   | 216 / 72 ms  |
| Chat, 400 messages                | 1272 / 336 ms | 336 / 184 ms |

### What changed

Website

- **Archivo from this site** (`docs/fonts/`, SIL Open Font License) instead of
  Google Fonts: no third-party connection before the first paint (it was the
  slowest part of the page). Only the weights 400–800 and widths 100–125% the
  site uses (latin: 90 → 56 KB); latin is preloaded, the other alphabets load
  only if a page needs them. A size-matched fallback (`Archivo Fallback`) keeps
  text from jumping when the font arrives (CLS 0). The privacy policy no longer
  lists Google Fonts.
- **Responsive pictures**: the four app screenshots are `<picture>` elements
  with AVIF and WebP at 640/1280/1920 wide and the JPG as fallback, with
  `width`/`height` kept. Below the fold they load lazily; the one at the top is
  low priority so the text and the hall picture come first.
- **The hall behind the title** is AVIF/WebP through `image-set()` (JPG
  fallback) and preloaded with high priority.
- **The live demo** draws each still frame once when it arrives (decoded off the
  main thread), and starts its animation and the video clips only after the
  page has loaded; for people with Save-Data on, the clips stay still pictures.
  Its clocks only touch the page when the text changes, and only while visible.
- The moving hall pauses when scrolled out of sight; the scroll handlers run at
  most once a frame and never measure the page.

Planner

- **Split by route**: a plan (cue sheet, phone layout, schedule, chat, share,
  print), the calendar and the two-step code form are separate files, loaded
  when first opened (and fetched in the background 2.5 s after signing in;
  opening a link straight to a plan fetches it at once). The first file went
  from 586 KB (165 KB gzip) to 498 KB (144 KB gzip).
- **The service worker keeps every part** on the device at install (the build
  lists all of them), plus the latin fonts; other alphabets are kept once first used.
- **IBM Plex from the Planner itself** (`planner/public/fonts/`, Google's files
  unchanged, SIL Open Font License), the sans font preloaded; and a preconnect
  to the account server.
- **Opens from what it kept**: signed in before on this device, the app shows
  your plans as they were at once, then checks the sign-in and loads the fresh
  list (stale-while-revalidate). Before, four requests to the account server
  ran one after another first.
- **Others' edits arrive batched**: a burst of cue changes (someone reorders 200
  cues) is put on screen in one update, sorted once.
- **Long lists**: each cue row (computer), cue card (phone) and chat message is
  its own memoized component, so typing redraws only what changed instead of
  every row. The remaining typing cost on a 500-cue sheet is the browser laying
  out the table; containment on the fields would remove it but moved their text
  by a pixel, so it was left out.

Considered and not done

- Minifying `site.css` / `site.js`: with gzip it would save about 1.5 KB, not
  worth a build step for the website.
- A smaller Supabase client: `@supabase/supabase-js` brings storage, functions
  and realtime into the first file (~85 KB of 498). Building the client from
  `@supabase/auth-js` and `@supabase/postgrest-js` and loading realtime with the
  plan would save ~25 KB gzip, but needs those packages as direct dependencies.
- Virtualizing the cue table (rendering only the visible rows) would break
  find-in-page, keyboard moves to off-screen rows and dragging; the memoized
  rows already remove most of the cost.

### Keeping it fast

- **New website pictures**: replace the JPGs in `docs/img` and `docs/media` (same
  file names; screenshots 1920×1080), then run `npm run site:images` (Python
  with Pillow 11.3+) and commit the JPGs and the copies it writes. The script
  lists which files it makes copies of.
- **Planner**: after changing `planner/`, run `npm run planner:build` and commit
  `docs/planner` (CI checks it). Keep big, rarely used parts behind `lazy()` in
  `planner/src/App.tsx`.
- **Fonts**: the page preloads `fonts/archivo-latin.woff2` (website) and
  `fonts/plex-sans-latin.woff2` (Planner); rename them in the `<link
rel="preload">` tags too if they change.

## Studio

Lumora Studio's speed on big projects: how it is measured, what was found, and what was changed.

### The big project

`?big` in a browser build of `editor/app` opens a made-up project built through the real project model (`editor/app/src/bench.ts`):

- a two-hour event, the live switch and four 4K cameras in a multicam group, 1,500 camera cuts on V1;
- the three sound tracks linked to every cut (6,320 clips in all);
- a title every minute (120), 200 picture-in-picture B-roll shots, 300 markers;
- a Basic correction on every shot, a vignette, sharpen, blur or grain on every third, a drop shadow on the B-roll.

It is only in development (`npm run edit:ui:dev`, then `http://localhost:1421/?big`) or in a build made with `VITE_LUMORA_BENCH=1`; the installers never carry it. In those builds `window.__studio` holds the editor's `doc`, `engine`, `ui` and `actions` for scripts.

### How it is measured

A Playwright script (Chromium, 1920×1080, WebGL through SwiftShader) opens the production build (`VITE_LUMORA_BENCH=1 vite build --config editor/vite.config.ts`, served with `vite preview`) and measures:

- **open**: navigation to the first clips drawn, and the main thread's busy time (CDP `Performance.getMetrics` TaskDuration);
- **zoom**: 40 zoom steps from Fit (the whole two hours) in and back out;
- **scroll**: 120 frames of scrolling the timeline 120 px a frame at about 15 px a second of video (and 60 px a frame zoomed out);
- **scrub**: 60 seeks, one a frame, across the first 100 seconds; and the time until the viewer's videos have the picture;
- **playback**: 10 seconds from the start: frames drawn and dropped, script time, React components rendered (counted through React's DevTools hook);
- **edits**: a rename, its undo and redo, five times each, until painted;
- **memory**: the JS heap after a garbage collection;
- **bundle**: the main script's size.

The builds were run alternating. The machine was a shared 4-core container with software WebGL, so wall-clock frame times and playback are much slower than on a real PC with a graphics card and noisy; the main thread's busy time per frame, render counts and DOM sizes are the reliable comparisons.

### Before and after

Two sessions: A (machine load about 8 on 4 cores; before: one run, after: median of two) and B (load about 20; before: one run, after: median of three). Main-thread time is the CDP TaskDuration per frame, seek or edit.

| Measure (big project)                       | Before (A)     | After (A)      | Before (B)    | After (B)     |
| ------------------------------------------- | -------------- | -------------- | ------------- | ------------- |
| Main script (minified / gzip)               | 1,960 / 566 kB | 1,222 / 378 kB |               |               |
| Open: wall / main-thread ms                 | 1,110 / 796    | 1,272 / 884    | 9,316 / 8,930 | 1,570 / 1,026 |
| DOM nodes at Fit (whole 2 h)                | 24,496         | 1,511          | 24,496        | 1,511         |
| Clip elements at Fit                        | 6,320          | 0 (bands)      | 6,320         | 0 (bands)     |
| Zoom: main-thread ms per step               | 794            | 145            | 1,105         | 211           |
| Zoom: frame ms (avg)                        | 956            | 385            | 1,232         | 507           |
| Scroll: main-thread ms per frame            | 27.9           | 18.2           | 88.4          | 20.1          |
| Scroll: script ms per frame                 | 7.5            | 3.4            | 62.5          | 4.3           |
| Scroll: components rendered in 120 frames   | 30,486         | 4,257          | 30,486        | 4,257         |
| Scroll zoomed out: main-thread ms per frame | 35.0           | 21.6           | 31.8          | 22.8          |
| Scrub: main-thread ms per seek              | 98.7           | 88.3           | 147.7         | 130.7         |
| Edit / undo / redo: main-thread ms per step | 190.5          | 55.2           | 108.1         | 81.4          |
| Project JSON.stringify (3.3 MB)             | 17 ms          | 16 ms          | 19 ms         | 16 ms         |
| JS heap after GC                            | 38.9 MB        | 38.6 MB        | 38.7 MB       | 38.8 MB       |

Playback and scrub-to-picture are not in the table: with SwiftShader and a loaded machine they swung from 12 to 42 frames drawn in 10 seconds and from 70 ms to 2.6 s between runs of the same build, so they say nothing about the changes. They need a run on a Windows PC with a graphics card. In the development build, an edit's profile no longer shows `texSubImage2D` (it was 1.5 s of 15 edits before).

### What was found

- **The timeline drew every clip on screen as a full React element, and drew all of them again on every scroll event.** At Fit the big project was 6,320 clip elements (24,500 DOM nodes); every scroll event re-rendered all visible clips, because each one got new handler functions, a new `view` array and the whole project as props, so `memo` never held. Each audio clip also redrew its waveform canvas on every scroll.
- **Every redraw of a stopped frame uploaded the video pictures to the GPU again** (`texSubImage2D` was the largest cost of an edit: the program monitor redraws after each change).
- **Effects left at their defaults still ran a full-frame pass each** (a Basic correction added and not changed, a vignette at 0).
- **The decoder library (mediabunny, 680 kB minified) was in the startup script**, though only the export, tracking and the stepping/scrubbing frame cache use it.
- Already in good shape (verified, unchanged): undo keeps whole projects but every edit is an immutable update, so steps share all unchanged clips (no deep copies); saving as you go waits for 1.2 s without changes and serializing the 3.3 MB project takes about 15 ms; recovery autosaves run once a minute only when something changed; waveforms and thumbnail strips are made by FFmpeg in Rust off the main thread and cached on disk; playback works out each frame's layers once per frame, decodes ahead of the playhead and the first frames of the next clips, reuses textures and render targets, and redraws only when something changed; panels follow the playhead a few times a second while the playhead line and clock move every frame without React.

### What was changed

- **Timeline** (`editor/app/src/ui/Timeline.tsx`): the view moves on in 512 px steps, so scrolling inside a step renders nothing; clips get stable handlers and only the numbers they show (color, media, the visible span of themselves), so an unchanged clip never re-renders; zoomed out, clips under 3 px are drawn as one band per track (Fit on the big project: 0 clip elements, about 1,500 DOM nodes); off-screen markers aren't drawn; tiny audio clips get no waveform canvas.
- **GPU uploads** (`render/compositor.ts`): a stopped video at a time, or a decoded frame, keeps a stamp, and its texture is reused when it is drawn again.
- **Identity effects** (`render/frame.ts`, `idleEffect`): Basic correction at its defaults, HSL with no change, vignette, black & white, invert, sharpen, grain, chromatic at 0 and a blur under 0.2 px are left out of the frame (the viewer, the native engine and the export all skip them).
- **Startup**: mediabunny is loaded the first time a film is made, a clip's frames are read or the frame cache decodes; the Color and Audio pages are loaded when opened (and fetched four seconds after the editor opens, so switching is instant).
- **Fastest by default** (`render/native/suggest.ts`, `ui/NativeOffer.tsx`): already on by default and verified: hardware decoding and encoding (render cache settings), playback proxies made automatically in the background for heavy files (4K and up, high bit rates, HEVC, 10-bit; nearest the playhead first) and used for playback, and the render cache in Smart mode (effect-heavy stretches cached while stopped). New: native playback (beta) is offered once, with one click, when the system check finds a graphics card of class 2 or better that the native engine can use. It is not turned on by itself while it is in beta; the GPU light on the viewer turns it off.

### Not changed, and ideas

- The editor still re-renders its panels on every change to the project; the panels each read the project, so the gain from more memoization is small next to the GPU's work.
- Playback in this container is limited by software WebGL (each 1080p frame is several full-frame passes in SwiftShader); on a real graphics card the same work takes a few milliseconds. Turning on native playback moves it off WebGL entirely.
- Supabase (about 230 kB, shared with Lumora's sign-in) is still in the startup script.

## Lumora (the live app: control and output windows)

Lumora's control window runs for hours during a live show, beside the output
windows, the recording and the stream. This is how to see what it costs, so a
change can be checked before and after.

### The measuring harness (`scripts/perf/`)

It builds the window as it ships (production build), opens it in Chromium with
a show built through the browser demo engine — four cameras (test pictures
played as camera streams by `fake-devices.js`), a lower third on air, five
microphones in the mixer, and recording on — and reads Chrome's own counters
over the DevTools protocol.

```sh
# 1. Build (React's profiling build, readable names; MIN=1 for the shipped minified build)
OUT=/tmp/lumora-perf npx vite build -c scripts/perf/vite.perf.config.ts
# 2. Serve it (the test cameras are served from PERF_MEDIA, made by step 3 with ffmpeg)
npx vite preview -c scripts/perf/vite.perf.config.ts --outDir /tmp/lumora-perf --port 1431 &
# 3. Measure: label, steady-state window (s), total time for the memory reading (s), port
node scripts/perf/measure.cjs after 60 180 1431          # recording on
NOREC=1 node scripts/perf/measure.cjs after 60 180 1431  # no recording
PROFILE=1 node scripts/perf/measure.cjs after 20 40      # + the 30 hottest functions
```

Playwright and a Chromium are needed (`PLAYWRIGHT=<module path>`,
`CHROME=<binary>` when they are not the defaults).

What it prints:

| Field                                       | Meaning                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `startupMs`                                 | Page start until the show is on screen (control window)                                      |
| `mainMsPerFrame`, `mainMsPerSecond`         | Main-thread busy time (Chrome's `TaskDuration`) per drawn frame and per second               |
| `scriptMsPerSecond`, `layoutMsPerSecond`    | Of that, JavaScript and layout                                                               |
| `longTasksPerMin`                           | Tasks over 50 ms (each one is a dropped frame or a late click)                               |
| `reactCommitsPerSec`, `reactRenderMsPerSec` | React's own count (`<Profiler>` in the profiling build)                                      |
| `census`                                    | Which components rendered in 10 s; `ROOT x` = x re-rendered by its own state, not its parent |
| `heapMB`                                    | JS heap after `totalSec` of show, after a garbage collection                                 |

Compare builds **side by side, alternating runs** (serve the old build on
another port): numbers move a lot with whatever else the computer is doing.
The harness runs Chromium without a GPU, so canvas drawing (the recording's
compositor) lands on the main thread — the worst case of a weak computer; on a
real graphics card that part is much cheaper.

Bundle size: `npm run ui:build` lists every file. The window loads
`index-*.js` plus its own part (`ControlApp-*.js` for the control window,
`OutputView-*.js` / `MultiviewView-*.js` for the others); rarely used windows
(test event, stage visuals, help, logo maker, branding, settings dialogs…) are
their own files, loaded the first time they open.

### Rules that keep it fast

- **Nothing re-renders React per frame or per meter tick.** Meters, timecodes
  and clocks write to the DOM directly (one shared animation frame for all
  meters, at the 30 Hz the levels change).
- **Don't wake the layout watcher.** `useFitLayout` (ControlView) measures the
  whole window when elements are added or removed; text that ticks must change
  a text node's `data`, not replace it (`textContent =`).
- **Per-frame loops stop when they have nothing to do** (e.g. a camera's
  frame watch uses the track's own frame count instead of a
  `requestVideoFrameCallback` per frame).
- **Audio settings are only sent when they change** (`glide()` in
  `soundEngine.ts`): the mixer runs 30 times a second.
- **A window loads only its own part**; new dialogs that open now and then go
  through `lazyPart()`. All windows share one stylesheet (`cssCodeSplit` is
  off), in the order it always had: `styles.css` is imported last, at the end
  of `ControlApp.tsx`.

### Last measurement (October 2026)

4-core Linux VM, no GPU, shared with other work: absolute numbers are high and
noisy; compare the columns. Medians of alternating runs, 60 s windows, heap
after 3 minutes.

|                                                                        | Before                 | After                          |
| ---------------------------------------------------------------------- | ---------------------- | ------------------------------ |
| Control window, no recording: main thread busy                         | 699 ms/s               | 600 ms/s (−14%)                |
| Control window, no recording: main thread per frame                    | 23.2 ms (30 fps)       | 17.4 ms (34.5 fps)             |
| JavaScript per frame                                                   | 3.0 ms                 | 1.9 ms                         |
| React commits / render time                                            | 7.1/s, 4.6–10 ms/s     | 5.4/s, 4.4 ms/s                |
| With recording (software canvas, `drawImage` ≈ 60% of the main thread) | 94% busy               | 94% busy (unchanged)           |
| JS heap after 3 min                                                    | 6.8 MB (7.7 recording) | 6.7 MB (7.4 recording)         |
| Startup to show on screen, control window                              | 655–713 ms             | 689–772 ms (within noise)      |
| Startup, output window                                                 | 280 ms                 | 244 ms                         |
| JS loaded by the control window                                        | 1531 KB                | 1339 KB                        |
| JS loaded by an output window                                          | 1531 KB                | 535 KB (heap 2.8 → 2.2 MB)     |
| Main bundle (`index-*.js`)                                             | 1568 KB                | 396 KB (+ 585 KB `ControlApp`) |
