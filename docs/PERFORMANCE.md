# Performance

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
