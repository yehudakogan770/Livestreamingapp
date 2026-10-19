import sys
root = sys.argv[1]
p = root + '/docs/COMPETITORS-STUDIO.md'
s = open(p).read()
a = s.index('### Counts for Studio')
b = s.index('### Only in Studio')
s = s[:a] + '''### Counts for Studio (78 rows)

| | Before this round | After this round |
|---|---|---|
| ✅ | 51 | 65 |
| ◐ | 4 | 6 |
| ❌ | 23 | 7 |

Still ❌: generative AI (extend, voices, dubbing, eye contact), automatic
B-roll, VST plug-ins, HDR and color management, a node compositor, publishing
to platforms other than YouTube, and client review links. Still ◐: a magnetic
timeline (ripple tools instead), who is speaking (by microphone, not by voice
on one microphone), voice isolation (filters, not a neural model), hand-drawn
masks (straight-sided, not animated), camera RAW (converted first) and the
native GPU engine (offered, not the default). See "What is left" below.

''' + s[b:]
a = s.index('## What is left, and why')
b = s.index('## Sources')
s = s[:a] + '''## What is left, and why

| Tool | Why not yet |
|---|---|
| Generative AI (extend, voices, dubbing, eye contact) | Needs cloud models and paid generation; Studio keeps every AI tool on the computer, free and private. |
| Automatic B-roll | Needs a stock library, or a reliable index of what each of your own shots shows; media search is the start of it. |
| Who is speaking on a single microphone | Needs a voice model to tell voices apart; today speakers are told apart by microphone or file. |
| A neural voice isolation model | Voice isolation uses noise-following filters today; a bundled model (as Resolve and Premiere ship) would be cleaner on hard recordings. |
| Animated hand-drawn masks (rotoscoping) | Drawn masks are fixed shapes on the frame; points that move over time, or follow a track, are next. |
| HDR grading and color management | HDR files are shown and exported as SDR today; a color-managed pipeline (Rec. 2020, PQ/HLG out) is a larger change to the compositor. |
| VST plug-ins, a node compositor | Large native projects (a plug-in host; a node graph and its viewer). |
| Publishing to TikTok, Facebook, Vimeo; client review links | Each platform needs its own app registration and review; client links need hosted video storage and a public review page. |
| Native GPU engine as the default | It is offered on capable graphics cards and falls back to WebGL by itself; making it the default needs testing on real Windows machines. |

''' + s[b:]
open(p, 'w').write(s)
