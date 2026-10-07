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
   Cut, overlays, Record, Live, Replay, slides, countdown and PANIC.

## Actions

Take, Cut, input into Next (preview), input on air (program), overlays,
black out, fade to black, recording, streaming, instant replay, slides,
presets, macros, the countdown, data rows, the next cue and PANIC. Inputs
can be given by number or by name.

## Feedbacks

Tally for any input (on air or in Next), overlay on, recording, live,
reconnecting (the stream dropped and Lumora is bringing it back) and PANIC.

## Variables

`$(lumora:program)`, `$(lumora:preview)`, `$(lumora:recording)`,
`$(lumora:streaming)` and `$(lumora:input_1_name)` and so on.

If the connection drops, the module connects again by itself.
