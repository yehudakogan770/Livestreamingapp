# Stage Visuals Live — project handoff

## What this is
A live VJ (visuals) controller for a keyboard player who performs at small events. It shows
beat-synced animated loops on a screen or projector behind the stage and is controlled live
from a laptop, a phone, or the player's **Yamaha PSR-SX720** arranger keyboard over USB MIDI.

Everything is in one self-contained file: `index.html` (HTML + CSS + JS + GLSL shaders).
No build step and no dependencies. The only external request is Google Fonts
(Chakra Petch, Bebas Neue, Great Vibes), with fallbacks.

It was built as a claude.ai published artifact. One feature (two-device linking) depends on
the claude.ai artifact runtime; see "Platform dependencies" below.

## How to run
- Open `index.html` in Chrome or Edge (Web MIDI needs Chromium). Serving it over
  `http://localhost` is better than `file://` for MIDI permissions: `npx serve .` or
  `python3 -m http.server`.
- `#output` in the URL = stage window mode (driven by a controller in another window on the same computer).
- `#screen` in the URL = two-device "stage screen" mode (needs the claude.ai room runtime).

## Features
- **13 music types (banks), 261 scenes**, each tied to a shader "look" + colour palette + speed + flash + bounce.
- **Beat clock**: BPM, tap tempo, sync-to-1, MIDI clock in (24 ppqn) with MIDI Start re-sync.
- **Scene launching**: quantised to now / next beat / next bar; crossfades (per-bank automatic
  fade length or a fixed one); auto-change every N bars in order or random.
- **Effect pads**: strobe (hold), flash, blackout (quick/slow fade), freeze, invert, text toggle,
  randomize, reset, colour cycle, next scene.
- **Advanced controls**: zoom, beat-synced spin, pan, zoom kick on beat, mirror (4 modes),
  kaleidoscope (3–12), hue shift, hue cycle, saturation, contrast, glow, trails (feedback) with
  trail zoom/spin, RGB split, pixelate, posterize, TV lines, vignette.
- **Overlay layer**: a second scene blended on top (add / screen / lighten / mask).
- **Text on screen**: 4 fonts, colour, size, height, pulse on beat.
- **Saved looks**: 8 slots storing scene + all effect params.
- **MIDI**: "Assign keys" learn mode maps notes / CCs / pitch bend to scenes, pads, looks, and
  sliders (continuous). "Flash when I play notes" reacts to velocity.
- **Outputs**: in-page preview; "Stage mode" (fullscreen same window); "Open stage window"
  (second window on same computer via BroadcastChannel); two-device mode (controller + screen).
- Settings persist in `localStorage` (`stageVisualsLive`, and `stageVisualsRole` for device role).

## Keyboard shortcuts
1–9, 0 start scene · Shift+1–0 music type · ↑/↓ music type · Space/→ next · ← previous ·
T tap · S sync to 1 · +/− tempo · Z strobe (hold) · X flash · B blackout · Q freeze · I invert ·
M mirror · K kaleidoscope · C colours · L text · R randomize · E reset effects ·
O stage window · H stage mode · F fullscreen · Esc exit stage / learn / save.

## Architecture (inside index.html)
**Rendering** — `makeRenderer(canvas, maxDpr)` builds a WebGL1 pipeline with 3 passes:
1. `SCENE_FS` → offscreen texture. Evaluates `scene(mode, uv, beat, speed, pulse, palette)` for
   the outgoing scene, incoming scene (crossfade `uMix`), and optional overlay. Applies camera
   (zoom/rotate/pan), kaleidoscope, mirror, per-scene bounce. Tone-maps with `1-exp(-x*1.5)`.
2. `COMP_FS` → ping-pong feedback textures. Pixelate, RGB split, glow, hue shift (YIQ),
   saturation, contrast, posterize, then trails via `max(current, prev*trail)` with zoom/rotation.
3. `FINAL_FS` → screen. Brightness, text overlay (2D canvas texture), TV lines, vignette,
   invert, white flash/strobe, blackout.
Internal resolution = canvas size × quality (1 / 0.75 / 0.5).

The renderer is driven by one plain object `u` (all uniforms) built each frame in `frame()`.
The same `u` is posted to the `#output` window, which renders it with its own renderer.

**Data** — `PALETTES` (3 colours each, passed as `mat3`) and `BANKS`:
`{name, bpm, fade, desc, scenes: [[name, mode, paletteKey, speed, flash, bounce], ...]}`.
Adding a scene = adding a row. Adding a new look = a new `else if(m==N)` branch in `scene()`
(put it before the final `else`, which is star drift) plus rows that use mode N.

**State** — `S` (persisted settings), `F = S.fx` (effect params, stored in looks), `T = S.text`,
`fx` (momentary toggles), clock: `baseBeat` + `baseTime` (beat = baseBeat + elapsed × bpm/60000).

**Two-device sync** (claude.ai `room` capability, declared at publish as `{room: {}}`):
- Presence `{role: 'controller'|'screen'}` to count connected screens.
- Controller emits `vj.state` (absolute state snapshot, on change ≤ ~12/s, plus 1 s keepalive)
  and `vj.hit` (white flash / note flash). The beat anchor is sent as epoch ms.
- Screen pings `vj.ping`; the controller answers `vj.pong`; the screen keeps the min-RTT offset
  sample as `clockOffset` so both devices share the beat.
- Screen forwards `vj.key` (keyboard) and `vj.midi` (notes/CC/pitch bend, throttled; MIDI
  clock is NOT forwarded) to the controller.

## Scene looks (shader modes)
| Mode | Look |
|---|---|
| 0 | neon rings |
| 1 | square corridor |
| 2 | checker warp |
| 3 | spiral |
| 4 | light-speed warp |
| 5 | hex tunnel |
| 6 | lasers |
| 7 | retro grid + sun |
| 8 | plasma |
| 9 | bokeh |
| 10 | aurora |
| 11 | bouncing EQ bars |
| 12 | bouncing dot grid |
| 13 | kaleidoscope |
| 14 | firelight |
| 15 | water ripples |
| 16 | sun rays |
| 17 | fireflies |
| 18 | stripes |
| 19 | star drift (final else branch) |
| 20 | soft clouds |
| 21 | moonlit sea |
| 22 | slow spotlights in haze |
| 23 | night sky |
| 24 | snowfall |
| 25 | silk ribbons |
| 26 | lava lamp |
| 27 | floating lanterns |
| 28 | contour waves |
| 29 | galaxy |
| 30 | sunset hills |
| 31 | infinite box zoom |
| 32 | triangle tunnel |
| 33 | octagon tunnel |
| 34 | shockwaves on the beat |
| 35 | waveform |
| 36 | tile flip |
| 37 | sunburst |
| 38 | wormhole |
| 39 | digital rain |
| 40 | hyper grid floor + ceiling |
| 41 | bouncing orbs |
| 42 | circle EQ |
| 43 | falling leaves |
| 44 | gentle rain |
| 45 | candles |
| 46 | sunlit water |
| 47 | stained glass |
| 48 | lightning storm |
| 49 | rising sparks |
| 50 | city at night |
| 51 | confetti |
| 52 | balloons |
| 53 | bubbles |
| 54 | fireworks |
| 55 | fairy lights |
| 56 | nebula |
| 57 | glowing cross |
| 58 | heaven light |
| 59 | neon shapes |

## Music types
| # | Name | Default BPM | Scenes | Auto fade |
|---|---|---|---|---|
| 1 | Slow | 70 | 21 | 8 beats |
| 2 | Medium | 100 | 20 | 2 beats |
| 3 | Fast | 150 | 20 | 0.5 beats |
| 4 | Bounce | 124 | 20 | 0 beats |
| 5 | Electric | 128 | 20 | 1 beats |
| 6 | Acoustic | 84 | 20 | 4 beats |
| 7 | Worship | 76 | 20 | 8 beats |
| 8 | Hip hop | 90 | 20 | 1 beats |
| 9 | Rock | 130 | 20 | 0.5 beats |
| 10 | Latin | 100 | 20 | 1 beats |
| 11 | Retro 80s | 118 | 20 | 1 beats |
| 12 | Party & kids | 120 | 20 | 1 beats |
| 13 | Space | 100 | 20 | 4 beats |

## Status
Verified: JS syntax; all shaders compile and render in headless Chromium (SwiftShader);
every bank loads its pads; a sample of new looks was visually checked; stage/screen role switching.

NOT yet verified — test first:
- Two-device mode with two real devices (only single-device mode was tested).
- Web MIDI with a real PSR-SX720, including MIDI clock (the keyboard's "transmit clock"
  setting must be on; exact menu name unconfirmed).
- `window.open` stage window and BroadcastChannel inside the claude.ai viewer iframe.
- Performance on the user's actual laptop at High quality with trails + overlay.

## Platform dependencies / known limitations
- Two-device linking uses `window.claude.use('room')`, which exists only when the page runs
  inside the claude.ai artifact viewer. Run locally or self-hosted, it degrades gracefully
  (status says devices can't link), and everything else works.
  **To make two-device mode work outside claude.ai**, replace the room layer (the block under
  `/* ---- two devices (room) ---- */`) with a small WebSocket relay (e.g. Node + `ws`) or
  WebRTC data channel, keeping the same message topics and payloads.
- Strobe and flashes can affect people with photosensitive epilepsy; keep strobe short.
- Keep the controller visible; a hidden or minimised tab throttles `requestAnimationFrame`.

## Ideas for next steps
- Split into modules (renderer, shaders, data, UI, MIDI, sync) with a simple build.
- Self-hosted sync server (see above) and a PWA install for offline gigs.
- MIDI clock forwarding from screen device (send derived BPM + beat anchor, not raw ticks).
- Setlist mode: ordered list of saved looks per song.
- Logo/image upload as an overlay; video export of loops.

## About the user
Keyboard player (Yamaha PSR-SX720, may move to Korg later), performs at small events. Plays
a wide range: slow songs, worship/gospel, dance, Latin, hip hop, rock, parties. Asked
specifically to have no hearts or love-heart imagery. Prefers simple, plain-language UI copy.
