# Lumora

Control Lumora from your Stream Deck, X-keys or Loupedeck, and light the
buttons with its tally.

## Setup

1. In Lumora: **Settings → Control API (Companion, OSC, tally)**. Turn on
   **HTTP and WebSocket** and press **Copy** next to the token.
2. Here: add the **Lumora** connection. Type the Lumora computer's address
   (`127.0.0.1` when Companion runs on the same computer), the port (8095
   unless you changed it) and paste the token.
3. Drag buttons from **Presets**: inputs (red on air, green in Next), Take,
   Cut, overlays, Record, Live, Replay, slides, countdown, PANIC, the next
   cue, the prompter, flashing the stage monitor and video play / pause.

## Actions

Take, Cut, input into Next (preview), input on air (program), overlays,
black out, fade to black, recording, streaming, instant replay (and keeping
the last minute), slides, presets, macros, the countdown, data rows, the
next cue, PANIC, video play / pause / from the start, playlists, song
lyrics, the prompter (scroll, stop, faster, slower, back to the top),
flashing the stage monitor, scoreboards (points, reset, game clock), PTZ
cameras (presets, moving, zooming) and an ATEM switcher connected to
Lumora. Inputs can be given by number or by name.

Lumora Titler graphics: set any field (a name, a score, a headline, from a
Companion variable too), step through the title's own data rows, and start,
stop or reset its timers (game clocks, countdowns). Take a graphic in and out
with Overlay or Input on air.

## Feedbacks

Tally for any input (on air or in Next), overlay on, recording, live,
reconnecting (the stream dropped and Lumora is bringing it back) and PANIC.

## Variables

`$(lumora:program)`, `$(lumora:preview)`, `$(lumora:recording)`,
`$(lumora:streaming)` and `$(lumora:input_1_name)` and so on.

If the connection drops, the module connects again by itself.
