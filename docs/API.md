# Lumora control API

Lumora can be run from Bitfocus Companion (Stream Deck, X-keys, Loupedeck),
tally lights, show-control systems and your own scripts. Turn it on in
**Settings → Control API (Companion, OSC, tally)**.

| What         | Where                                | Needs the token                                       |
| ------------ | ------------------------------------ | ----------------------------------------------------- |
| HTTP         | `http://<computer>:8095/api/...`     | yes                                                   |
| WebSocket    | `ws://<computer>:8095/api/ws`        | yes                                                   |
| OSC over UDP | port `8096`, addresses `/lumora/...` | no (only this computer, unless you allow the network) |

The ports can be changed in the settings. `GET /api` answers without a token
(`{"app":"Lumora","api":1,"version":"..."}`), so a control panel can find Lumora.

## The token

Every HTTP and WebSocket request carries the token, in one of three ways:

```
Authorization: Bearer <token>
X-Lumora-Token: <token>
http://192.168.1.20:8095/api/do/cut?token=<token>
```

A wrong token gets `401 {"ok":false,"code":"wrongToken"}`. After five wrong
tries from one address, that address gets `429 tooManyTries` for 30 seconds.
Making a new token in the settings stops everything using the old one.

The phone remote's addresses (`/api/do/...` on the phone remote's port) take
the token in place of the PIN too.

## Commands

`GET` or `POST /api/do/<command>?<values>`. Values can also be sent as a JSON
object or a form in the body of a `POST`. The answer is `{"ok":true}` or
`{"ok":false,"error":"what is wrong"}`.

Inputs are named by their number as shown on the tiles (`input=3`) or by name
(`name=Camera%201`). Screens are `live` (the default) or `back`. `state` is
`on`, `off` or `toggle` (the default).

| Command                                 | Values                                                                                                           | Does                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `take`                                  | `screen`, `transition` (`fade`, `dip`, `wipe`...), `ms`                                                          | Next goes on air with a transition                     |
| `cut`                                   | `screen`                                                                                                         | Next goes on air at once                               |
| `preview`                               | `input` or `name`, `screen`                                                                                      | Put an input in Next (preview)                         |
| `cutto`                                 | `input` or `name`, `screen`                                                                                      | Put an input on air at once (program)                  |
| `playnow`                               | `input` or `name`, `screen`, `transition`, `ms`                                                                  | Put it in Next and take it                             |
| `blank`                                 | `screen`, `state`                                                                                                | Black out a screen                                     |
| `ftb`                                   | `screen`                                                                                                         | Fade to black                                          |
| `overlay`                               | `channel` (1 to 4), `state`                                                                                      | Overlay on or off                                      |
| `overlaysoff`                           |                                                                                                                  | Every overlay off                                      |
| `play`, `pause`, `playpause`, `restart` | `input` or `name`                                                                                                | A video input                                          |
| `playlist`                              | `input` or `name`, `item` (a number, `next`, `previous`)                                                         | A playlist                                             |
| `nextcue`                               |                                                                                                                  | The next cue in the run of show                        |
| `preset`                                | `number`                                                                                                         | Run a preset                                           |
| `nextpreset`, `previouspreset`          |                                                                                                                  | Step through the presets                               |
| `panic`                                 | `state`                                                                                                          | PANIC: the safe picture on every screen                |
| `flash`                                 |                                                                                                                  | Flash the stage monitor to get the speaker’s attention |
| `slide`                                 | `input` or `name`, `to` (`next`, `previous` or a number)                                                         | Slides                                                 |
| `score`                                 | `input` or `name`, `team` (`home`, `away`), `add`                                                                | Scoreboard                                             |
| `scorereset`                            | `input` or `name`                                                                                                | Scoreboard back to 0 : 0                               |
| `clock`                                 | `input` or `name`, `state`                                                                                       | Scoreboard clock                                       |
| `datarow`                               | `to` (`next`, `previous` or a row number)                                                                        | The data source's row for titles                       |
| `verse`, `lyrics`                       | `input` or `name`, `to`                                                                                          | Verses and song lyrics                                 |
| `prompter`                              | `do` (`start`, `stop`, `toggle`, `faster`, `slower`, `top`)                                                      | The prompter                                           |
| `record`                                | `state`                                                                                                          | Start or stop recording                                |
| `stream`                                | `state`                                                                                                          | Go live or end the stream                              |
| `replay`                                | `seconds` (1 to 60), `slow` (`1` for half speed)                                                                 | Instant replay                                         |
| `replaybuffer`                          | `state`                                                                                                          | Keep the last minute for replays                       |
| `macro`                                 | `name`, or `number` (1, 2...)                                                                                    | Run a macro                                            |
| `stopmacros`                            |                                                                                                                  | Stop every macro that is running                       |
| `timer`                                 | `input` or `name` (the main countdown if left out), `do` (`start`, `pause`, `toggle`, `reset`, `add`), `minutes` | Countdown                                              |
| `ptz`                                   | `input` or `name`, `preset`, `move`, `zoom`, `speed`                                                             | PTZ camera                                             |
| `atem`                                  | `do` (see below), `input`, `keyer`, `number` or `name`, `state`, `style`, `frames`                               | An ATEM switcher connected to Lumora                   |

`GET /api/commands` lists them, `GET /api/macros` lists the macros with their
numbers.

### ATEM switchers

When a Blackmagic ATEM is connected (Settings → ATEM switcher…), the `atem`
command switches it: `do=cut`, `do=auto`, `do=program&input=2`,
`do=preview&input=3` (the ATEM's own input numbers), `do=ftb` (with `state`),
`do=style&style=mix|dip|wipe|dve|stinger`, `do=rate&frames=30`,
`do=dsk&keyer=1` (`state=on|off|toggle|auto`), `do=usk&keyer=1`,
`do=macro&number=3` or `do=macro&name=Intro`, `do=stopmacro`. OSC:
`/lumora/atem cut`. With "Follow the ATEM's tally" on, the tally lights
Lumora's inputs mapped to the ATEM's cameras from the ATEM's own tally, and
the tally message gains an `atem` part (`connected`, `program`, `preview`
and their names).

Examples:

```
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8095/api/do/cut
curl "http://127.0.0.1:8095/api/do/preview?input=3&token=$TOKEN"
curl "http://127.0.0.1:8095/api/do/cutto?name=Pulpit&token=$TOKEN"
curl "http://127.0.0.1:8095/api/do/overlay?channel=1&state=on&token=$TOKEN"
curl "http://127.0.0.1:8095/api/do/macro?name=Start%20show&token=$TOKEN"
curl -X POST -d '{"to":"next","input":4}' "http://127.0.0.1:8095/api/do/slide?token=$TOKEN"
```

## State and tally

`GET /api/tally`:

```json
{
  "live": { "program": 2, "programName": "Pulpit", "preview": 3, "previewName": "Wide", "blank": false },
  "back": { "program": 5, "programName": "Slides", "preview": null, "previewName": null, "blank": false },
  "inputs": [
    { "number": 1, "name": "Camera 1", "program": false, "preview": false, "overlay": false },
    { "number": 2, "name": "Pulpit", "program": true, "preview": false, "overlay": false },
    { "number": 3, "name": "Wide", "program": false, "preview": true, "overlay": false }
  ],
  "overlays": [true, false, false, false],
  "panic": false,
  "recording": true,
  "streaming": true,
  "rehearsal": false,
  "replay": false,
  "reconnecting": 0
}
```

An input is on `program` when it is on air on either screen or inside an
overlay that is on. `reconnecting` is which try at bringing back a dropped
stream Lumora is on (0 when the stream is fine or off).

`GET /api/tally/3` answers one word for the simplest tally lights:
`program`, `preview` or `off`.

`GET /api/state` is the tally plus what the control window says is running.

## WebSocket

Connect to `ws://<computer>:8095/api/ws?token=<token>`. Lumora sends the state
straight away, then a message every time the tally or what is running
(recording, streaming, reconnecting) changes:

```json
{"type":"state","tally":{...},"app":{...}}
{"type":"tally","tally":{...}}
{"type":"app","app":{"recording":true,"streaming":false,"reconnecting":2,...}}
```

Send commands as JSON, with an optional `id` that comes back in the answer:

```json
{"cmd":"take","screen":"live","id":"7"}
{"type":"result","id":"7","ok":true}
```

or as text: `preview?input=3`. `{"cmd":"state"}` asks for the state now,
`{"cmd":"ping"}` answers `{"type":"pong"}`. Lumora pings every client and lets
one go that stops answering or falls far behind.

## OSC

Send to UDP port 8096. The address is `/lumora/<command>`; values come as
arguments or further address parts, filling the command's main value first,
then `state`. `key=value` strings name a value.

```
/lumora/cut
/lumora/preview 3
/lumora/preview/3
/lumora/overlay 1 1          (overlay 1 on; 0 is off)
/lumora/macro "Start show"
/lumora/timer start
/lumora/slide "input=4" next
```

Bundles are opened. OSC has no token, so by default Lumora only listens to
OSC from this computer (where Companion usually runs). Allowing the network
lets anyone on it send commands: do it only on a network you trust.

## Bitfocus Companion

The `companion/` folder has a Companion module (`companion-module-lumora`)
with actions for every command, feedbacks for tally (red on air, green in
Next), recording, streaming and reconnecting, and ready-made presets. See
`companion/companion/HELP.md`.

Without the module, Companion's **Generic HTTP** connection works with the
`/api/do/...` addresses above.

## Operator seats (other Lumora computers)

Not part of the control API, but on the same network: Settings → Operators…
lets other computers running Lumora join this show as **seats** (Director,
Graphics, Audio, Replay, Cameras or Custom). The code is in `crates/seats`;
the app side is `src-tauri/src/seats.rs` and `app/src/seats/`.

- **Port 8097**: TCP for seats, and UDP on the same number for "is there a
  show?" broadcasts. Shows are also announced over mDNS / Bonjour as
  `_lumora._tcp.local` (TXT: `id`, `name`, `v`). The firewall must allow
  Lumora on private networks.
- **Pairing**: X25519 with a commitment, then a 6-digit code shown on the show
  computer and typed at the seat (checked on the seat first, then by the show
  computer); the show operator approves the seat and picks its role. Repeated
  wrong codes lock the address out for a while.
- **After pairing**: each connection makes fresh X25519 keys mixed with a
  32-byte seat secret kept on both computers; every message is sealed with
  ChaCha20-Poly1305 and numbered (no reading, changing, replaying or
  reordering). No internet is needed.
- **Messages**: length-prefixed JSON frames (`crates/seats/src/wire.rs`). The
  seat gets the whole show (`{revision, show, app}`) on joining, then only what
  changed (paths and new values) at most every 30 ms; actions are the engine's
  own actions (the same JSON as `dispatch`), and the show computer checks each
  against the seat's role (`crates/seats/src/role.rs`) before the engine sees
  it. The show computer's own things (its screens, sound devices, files, data
  file) are never accepted from a seat, whatever its role.
- **Pictures and levels**: a seat asks for `program/<screen>`, `next/<screen>`,
  `source/<id>` and `meters`; it gets small JPEGs about five times a second and
  levels ten times a second, only while it asks.
- A seat that drops, lags or misbehaves is let go; the show carries on. Seats
  reconnect by themselves (and look for the show again if its address changed).
