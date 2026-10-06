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
