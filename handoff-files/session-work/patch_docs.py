import re
import sys

ROOT = sys.argv[1]


def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:80])
        s = s.replace(a, b, 1)
    open(p, 'w').write(s)


L = ROOT + '/docs/COMPETITORS-LUMORA.md'
edit(L, [
    ("""Built in this round (now ✅): marks while recording that Lumora Studio picks
up, triggers on sound level / lost picture / a video about to end / recording
or stream starting / every few minutes, event templates in the first setup,
Facebook live comments, speaker timing on the Monitor (amber, red, time over,
progress bar) and on the speaker's phone, drawing on screen (telestrator),
find any command by typing (Ctrl+K), thank-yous on screen for viewers'
support (Super Chats, members, subscribers, bits, raids), Twitch, Kick,
LinkedIn and X in the streaming list.""",
     """Built in this round (now ✅): this computer's sound as an input (everything
it plays except Lumora's own, or one program), a copy of each recording in a
cloud folder, word clouds and star ratings, questions that phones vote up and
the operator approves first, reactions rising over the picture, results
exported as spreadsheets, and the Stream Deck's input keys showing each
input's live picture (with PTZ camera keys). The Zoom row moved from ❌ to ◐
(Zoom's own NDI output, or its window with its sound).

Earlier rounds: marks while recording that Lumora Studio picks up, triggers
on sound level / lost picture / a video about to end / recording or stream
starting / every few minutes, event templates in the first setup, Facebook
live comments, speaker timing on the Monitor and the speaker's phone, drawing
on screen (telestrator), find any command by typing (Ctrl+K), thank-yous on
screen for viewers' support, Twitch, Kick, LinkedIn and X in the streaming
list."""),
    ("""| This computer's sound / one app's sound      | vMix 28, OBS                             | ❌                                                                    |""",
     """| This computer's sound / one app's sound      | vMix 28, OBS                             | ✅ (new) everything it plays (never Lumora's own) or one program      |"""),
    ("""| Cloud recording copy                                  | SY, RS, RV                               | ❌ Lumora records locally (works with no internet)               |""",
     """| Cloud recording copy                                  | SY, RS, RV                               | ✅ (new) each recording copied to a OneDrive, Dropbox or Google Drive folder when it ends (recorded locally first, so no internet is needed) |"""),
    ("""| Zoom meeting as an input                              | vMix, EC, WC (coming)                    | ❌                                                               |""",
     """| Zoom meeting as an input                              | vMix, EC, WC (coming)                    | ◐ Zoom's own NDI output as an NDI input, or the Zoom window with Zoom's sound (new); no Zoom sign-in inside Lumora |"""),
    ("""| Word cloud, rating scales                       | SM                      | ❌             |""",
     """| Word cloud, rating scales                       | SM                      | ✅ (new)       |
| Q&A: phones vote questions up, operator approves first | SM, Pigeonhole          | ✅ (new)       |
| Reactions rising over the picture               | SM (Menti), SY          | ✅ (new)       |
| Results export (spreadsheet)                    | SM                      | ✅ (new) CSV   |"""),
    ("""| Stream Deck, Companion, MIDI, OSC, HTTP API    | vMix, OBS (websocket), ATEM, TC, PP, RE | ✅                             |""",
     """| Stream Deck, Companion, MIDI, OSC, HTTP API    | vMix, OBS (websocket), ATEM, TC, PP, RE | ✅                             |
| Each input's live picture on its Stream Deck key | Companion (partly)                    | ✅ (new) with tally frame      |"""),
])

s = open(L).read()
start = s.index('## What is left, and why')
s = s[:start] + """## What is left, and why

- **VST plugins.** Lumora's sound runs in the app's own sound engine (the
  mixer, EQ, gate, compressor, noise removal, limiter and ducking). Hosting
  VST3 plugins needs a native audio path with each plugin in its own process,
  so a plugin that crashes can't stop the show, and testing with real
  plugins on Windows. Not started; it stays out rather than half working.
- **This computer's sound** is new: it uses Windows' own process loopback
  (Windows 10 version 2004 and later), builds and passes its checks for
  Windows, and should be tried once on the show computer before the first
  event (Add input → This computer's sound).
- **Zoom.** Zoom's own NDI output (on Zoom's business plans) already comes in
  as an NDI input; otherwise the Zoom window (screen capture) with Zoom's
  sound (This computer's sound → Zoom) does it. A Zoom sign-in inside Lumora
  needs Zoom's Meeting SDK and a Zoom app review.
- **Virtual camera.** A Windows virtual camera is a signed system component;
  it cannot be built or tested here. NDI out with the free NDI Webcam already
  feeds Zoom and Teams.
- **AI clips, follower alerts.** Clips are picked by hand (instant-replay
  highlights and marks); new followers on Twitch need a Twitch sign-in;
  every other kind of support is thanked on screen.
- **Per-output size, Mac version, a backstage chat for guests.** Larger
  engine and guest-page work, tracked in FEATURES.md.
"""
open(L, 'w').write(s)

# Count the rows.
rows = [l for l in open(L).read().split('\n') if l.startswith('| ') and not l.startswith('| Feature') and not l.startswith('| ---') and not l.startswith('|   ') and '|' in l[1:]]
matrix = open(L).read().split('## The matrix')[1].split('## What users complain')[0]
cells = []
for l in matrix.split('\n'):
    if not l.startswith('| ') or l.startswith('| Feature') or l.startswith('| ---'):
        continue
    last = l.rstrip().rstrip('|').split('|')[-1].strip()
    cells.append(last)
yes = sum(1 for c in cells if c.startswith('✅'))
part = sum(1 for c in cells if c.startswith('◐'))
no = sum(1 for c in cells if c.startswith('❌'))
print('Lumora', yes, part, no, len(cells))
s = open(L).read()
s = re.sub(r'\| ✅ Lumora has it         \| \d+   \|', f'| ✅ Lumora has it         | {yes}   |', s)
s = re.sub(r'\| ◐ Partly, or another way \| \d+     \|', f'| ◐ Partly, or another way | {part}     |', s)
s = re.sub(r'\| ❌ Not yet               \| \d+     \|', f'| ❌ Not yet               | {no}     |', s)
open(L, 'w').write(s)

D = ROOT + '/docs/COMPETITORS-PLANNER-DECK-AUDIENCE.md'
edit(D, [
    ("""| PTZ cameras                                                    |   ◐    | ✅  | ❌  |  ◐  | ✅  |  ◐  |  ◐  |""",
     """| PTZ cameras: saved shots, home, move and zoom while held       |   ✅   | ✅  | ❌  |  ◐  | ✅  |  ◐  |  ◐  |"""),
    ("""| Picture of each input on its key                               |   ❌   | ❌  | ❌  | ❌  |  ◐  | ❌  | ❌  |""",
     """| Picture of each input on its key, framed in tally colors       |   ✅   | ❌  | ❌  | ❌  |  ◐  | ❌  | ❌  |"""),
    ("""**Lumora: 21 ✅, 1 ◐, 2 ❌** (of 24). PTZ is ◐ because it is in Lumora's
Companion module (presets, move, zoom), not yet a Stream Deck key.""",
     """**Lumora: 23 ✅, 0 ◐, 1 ❌** (of 24), up from 21 ✅, 1 ◐, 2 ❌: each input's
live picture on its key (about once a second, framed red on air and green in
Next) and PTZ keys (a saved shot or home with a press; pan, tilt and zoom
while the key is held, stopping when it is let go)."""),
    ("""- Installed and updated from the switcher app.""",
     """- Installed and updated from the switcher app.
- Input pictures that cost nothing when no key shows them: Lumora draws a
  small picture only for the inputs a key asked for in the last few seconds."""),
    ("""- **Input pictures on keys**: Lumora's phone remote has no endpoint that sends
  small JPEG frames of each input; it needs one in `src-tauri/src/remote.rs`
  (Lumora core, Rust) before the plugin can draw them.
- **Profiles switching by themselves**: needs ready-made `.streamDeckProfile`
  files bundled with the plugin, made and checked in the Stream Deck app on a
  real device.
- **PTZ keys**: Lumora's remote server has no PTZ action for the phone remote
  protocol the plugin uses; the Companion module already does PTZ over the
  control API.""",
     """- **Profiles switching by themselves**: needs ready-made `.streamDeckProfile`
  files bundled with the plugin, made and checked in the Stream Deck app on a
  real device (a profile file made by hand could fail to load).
- **Input pictures, first check**: drawn into the key's SVG as an embedded
  JPEG; worth one look on a real Stream Deck before an event."""),
    ("""| Q&A: upvotes                                            |   ❌   | ✅  | ✅  | ❌  | ✅  | ✅  |
| Q&A: approve before others see it                       |   ◐    | ✅  | ✅  | ❌  | ✅  | ✅  |""",
     """| Q&A: upvotes (once per phone, can be taken back)        |   ✅   | ✅  | ✅  | ❌  | ✅  | ✅  |
| Q&A: approve before others see it                       |   ✅   | ✅  | ✅  | ❌  | ✅  | ✅  |"""),
    ("""| Word cloud                                              |   ❌   | ✅  | ✅  | ✅  | ✅  | ✅  |
| Ratings / feedback form                                 |   ❌   | ✅  | ✅  |  ◐  | ✅  | ✅  |
| Emoji reactions on screen                               |   ❌   |  ◐  | ✅  | ❌  |  ◐  |  ◐  |
| Results export                                          |   ❌   | ✅  | ✅  | ✅  | ✅  | ✅  |""",
     """| Word cloud (words can be taken out by the operator)     |   ✅   | ✅  | ✅  | ✅  | ✅  | ✅  |
| Ratings / feedback (stars and comments)                 |   ✅   | ✅  | ✅  |  ◐  | ✅  | ✅  |
| Reactions on screen                                     |   ✅   |  ◐  | ✅  | ❌  |  ◐  |  ◐  |
| Results export                                          |   ✅   | ✅  | ✅  | ✅  | ✅  | ✅  |
| Opened and closed from a Stream Deck or Companion       |   ✅   | ❌  | ❌  | ❌  | ❌  | ❌  |"""),
    ("""**Lumora: 13 ✅, 1 ◐, 5 ❌** (of 19).""",
     """**Lumora: 20 ✅, 0 ◐, 0 ❌** (of 20), up from 13 ✅, 1 ◐, 5 ❌ (of 19)."""),
])
s = open(D).read()
start = s.index('### Left, and why\n\nUpvotes and approval for Q&A')
s = s[:start] + """### Built in this round

- **Q&A**: phones vote questions up (once each, and can take the vote back);
  the list on the phones puts the most wanted first and answered ones last.
  "Hold new questions until I approve them" keeps every new question off the
  phones until the operator approves it (`POST /api/ask/vote`).
- **Word cloud**: a poll kind; up to three words or short phrases from each
  phone, counted whatever their letter case, the most sent drawn biggest;
  the operator can take any word out (`POST /api/word`).
- **Rating**: a poll kind; one to five stars, the average and how the stars
  were given on screen, with an optional comment that only the operator sees.
- **Reactions**: Love, Haha, Wow and Yes, tapped on phones, gathered by the
  app's server four times a second so a crowd never floods the show, rising
  over the picture as flat badges (`POST /api/react`).
- **Export**: each poll, word cloud, rating and trivia game, and the
  questions, save as a CSV that opens in Excel, Numbers or Google Sheets
  (cells that would run as formulas are kept as text).
- **Control**: the control API's `voting`, `questions` and `reactions`
  commands, in Companion too.
"""
open(D, 'w').write(s)
print('ok')
