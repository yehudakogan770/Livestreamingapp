# Stage Visuals in Lumora

Stage Visuals Live (this folder, unchanged from the original project) becomes
Lumora's **visuals engine**: beat-synced animated backgrounds, mainly for the
Back Screen, controllable from Lumora, a phone, or a MIDI keyboard.

## What Lumora uses

| Stage Visuals part | Becomes in Lumora |
|---|---|
| WebGL renderer (`makeRenderer`, `SCENE_FS` / `COMP_FS` / `FINAL_FS`) | The renderer inside a **Stage visuals source**, drawn on any output (Back Screen by default) |
| `BANKS` (13 music types, 261 scenes) and `PALETTES` | Built-in visuals library; users can add their own scenes and colour sets |
| Beat clock (BPM, tap, sync to 1, MIDI clock in) | **Lumora's show beat clock** — one tempo shared by visuals, loops and cues |
| Effect pads, advanced effects, overlay, text, saved looks | The **Stage visuals** page, plus quick pads on the Back Screen strip and the All-three view |
| MIDI learn ("Assign keys") | Lumora-wide MIDI: the keyboard can trigger scenes and pads **and** Lumora actions (TAKE, presets, blank…) |
| `#output` window + BroadcastChannel | Replaced by Lumora's own output windows, driven by the engine |
| Two-device `room` layer (claude.ai only) | Replaced by Lumora's local-network remotes (no internet needed) |
| `localStorage` settings | Saved in the Lumora show / library |

## Plan

1. **Now** — kept here as a module; designs updated (Stage visuals page, Back
   Screen strip, All-three view).
2. **With outputs (milestone 2–3)** — the renderer runs inside the Back Screen
   output window (it is WebGL, which the app's web view supports). The engine
   holds the visuals state (music type, scene, beat anchor, effect settings);
   the output draws it every frame, exactly like `u` today.
3. **MIDI** — the engine reads the keyboard (Yamaha PSR-SX720 first) and turns
   notes / controllers / clock into Lumora actions, reusing the learn mode.
4. **Native engine (later)** — shaders are ported to the GPU engine (wgpu /
   Direct3D 12) so visuals mix with cameras at full quality with no extra cost.

## Notes carried over from the original project

- No hearts / love-heart imagery (the author's request).
- Keep strobe short: flashing can affect people with photosensitive epilepsy.
- Plain, simple wording in the controls.
