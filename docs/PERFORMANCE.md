# Performance — how to measure

Lumora's control window runs for hours during a live show, beside the output
windows, the recording and the stream. This is how to see what it costs, so a
change can be checked before and after.

## The measuring harness (`scripts/perf/`)

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

## Rules that keep it fast

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

## Last measurement (October 2026)

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
