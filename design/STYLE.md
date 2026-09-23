# Lumora artboard rules (read fully before writing)

You are designing screens for **Lumora**, a Windows desktop app that runs live events: it controls the
live stream ("Live Screen"), the projector behind the stage ("Back Screen") and the stage "Monitor"
(TEXT ONLY — messages/clock/countdown for the people on stage). Full spec: /home/user/Livestreamingapp/docs/SPEC.md

Reference artboard for the look and the file format: `project/Main.dc.html` in the same folder. READ IT FIRST and copy its structure.

## Look (Lumora's own style — professional broadcast console, NOT sci-fi, NOT a vMix copy)
- Font: 'Segoe UI', system-ui, sans-serif. Numbers/timecodes: Consolas, monospace. No Google fonts except
  `Frank Ruhl Libre` for Hebrew text.
- Colours: page bg #15171b · bars/side panels #1a1d22 · panels/cards #1e2127 · raised #262a31 ·
  buttons #2a2e36 · hover/strong #343944 · hairline borders #2c3038 · wells/inputs #101216 ·
  text #e4e5e7 / secondary #d4d5d8 / muted #a9abb0 / faint #8e9096.
- Accent (selection, primary action): teal #4fb3bf, selected bg #1d3b40, text on teal #0e2a2e, light teal text #8fd3db / #dff4f6.
- On-air/program red #c7372f (bright #e0473b), preview green #2f8f4e (bright #3fbf5a). Danger/panic #5a1f1b bg.
- NO yellow/gold anywhere except the logo. Sliders & checkboxes: `accent-color:#4fb3bf` in the helmet style.
- Flat controls, border-radius 6px (small buttons 4px), 1px #2c3038 borders, no gradients on buttons, no glow, no emoji.
- Section headings: 10–11px, weight 700, letter-spacing .08em, uppercase, colour #8e9096.
- Faders: draw them like Main.dc.html (track + light pill cap #d9dce3 + invisible `.vrange` input on top).
- Video "pictures" are solid tonal panels (e.g. #34404c, #473a2c, #27403f) with a small label — never gradients.
- **Never remove or hide needed controls to look clean.** Clean = grouping, alignment, spacing, hierarchy.
  It's for live events: important actions big and obvious, one-click where possible, show keyboard shortcuts.
- Every popup/page other than the main screen: a 64px header with the title and an X close button
  (`<a href="Main.dc.html" aria-label="Close" …>`), like GoLive.dc.html.
- Placeholder content in [brackets] (e.g. [Event name]); no lorem ipsum; no invented statistics.

## File format (each rule fails silently if broken)
- One self-contained `.dc.html` file per artboard, in `project/`. Copy Main.dc.html's skeleton exactly:
  `<!doctype html>`, `<head>` with `<meta charset>`, `<title>`, and EXACTLY `<script src="./support.js"></script>`,
  then `<body><x-dc><helmet><style>…</style></helmet> ROOT </x-dc> <script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":W,"height":H}}'> class Component extends DCLogic { … } </script></body></html>`.
- ROOT is one `<div>` with a FIXED `width`/`height` equal to the artboard size (and to `$preview`).
- Close every element (`<div></div>`, `<span></span>`, even `<textarea></textarea>`; void tags like `<input>` are fine). Quote every attribute.
- Inline `style="…"` for everything. `{{hole}}` is a dotted lookup ONLY (no expressions, no `!`, no `+`).
  Compute strings/booleans in `renderVals()` and expose them by name. A whole style may be a hole: `style="{{x.style}}"`.
- Loops: `<sc-for list="{{items}}" as="it" hint-placeholder-count="4"> … {{it.name}} … </sc-for>`.
  Conditionals: `<sc-if value="{{flag}}" hint-placeholder-val="{{true}}"> … </sc-if>`.
- Events: `onClick="{{handler}}"`, `onInput="{{h}}"`, `onChange="{{h}}"`, `onDoubleClick="{{h}}"` — functions returned from renderVals
  (per-item handlers attached to each list item in renderVals). State via `this.state` / `this.setState`.
- Links between screens: `<a href="Main.dc.html">` (style the `<a>` itself as the button).
- Classic JS only: `class Component extends DCLogic { constructor(props){super(props); this.state={…};} renderVals(){ return {…}; } }`. No imports, no innerHTML, no global keydown.
- Use real `<button>`, `<input>`, `<label>`, `<select>`; `aria-label` on icon-only buttons. Icons: small inline stroke SVG or text glyphs (▶ ❚❚ ✕), never emoji.
- Make it interactive where cheap (tabs, selections, toggles) so it can be clicked through.
- Do NOT publish, do NOT touch canvas.json, do NOT edit other agents' files. Only write the files you were assigned.

## Finishing standard (added)
- Every artboard includes the shared `polish.css` block in its helmet (between `lumora-polish:start/end`):
  fader-style slider thumbs with a teal filled track (`--fill`, kept in sync by `__fill()`), toggle switches
  instead of checkboxes, custom dropdown chevrons, hover/press/focus states, thin scrollbars, tabular numbers.
- Video transports: seek bar with chapter marks, restart, −10 s, play/pause, +10 s, end, elapsed / total / remaining,
  loop and speed — usable while on air. Live sources (cameras) show the transport disabled with "LIVE".
- Layout is verified with `check-layout.js` (renders every artboard and reports overlaps, clipped or hidden content).

## Professional polish rules (added)
- No tiny ALL-CAPS letter-spaced labels. Section labels are sentence case, 12px, weight 600, #b4b8bf.
  Uppercase is reserved for broadcast conventions only: TAKE, CUT, ON AIR, PANIC.
- No helper sentences under dialog titles; dialog headers are 52px with a 16px title.
- Weight 600 max for UI text (700+ only for large numerals).
- Pictures, not coloured boxes: every video/camera/loop area uses `<dc-import name="Scene" kind="…">`
  (stage, side, closeup, crowd, opening, sponsors, tribute, aurora, particles, warm, slides, pesukim,
  browser, split, overlay, lower, timer, eventlogo, credits, black). The host element must be positioned.
- Accent (teal) only for the primary action, active toggles and focus — selection uses neutral #243039.
