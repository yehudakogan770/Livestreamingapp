import re
root = '/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
p = root + 'docs/COMPETITORS-STUDIO.md'
s = open(p).read()
# "new" now means this round only.
s = s.replace(' **new**', '')


def st(tool_start, mark):
    """Set Studio's cell in the row whose tool cell starts with tool_start."""
    global s
    pat = re.compile(r'^(\| ' + re.escape(tool_start) + r'[^|]*\|)([^|]*)\|', re.M)
    m = pat.search(s)
    assert m, tool_start
    s = s[: m.start()] + m.group(1) + ' ' + mark + ' |' + s[m.end():]


st('Magnetic (gapless) timeline', '✅ **new**')
st('Who is speaking, named in the transcript', '✅ **new** (by voice or microphone)')
st('Speech enhancement, voice isolation', '✅ **new** (neural model, on this computer)')
st('B-roll put in automatically', '◐ **new** (from your own media)')
st('VST / Audio Unit plug-ins', '◐ **new** (VST3 effects on clips)')
st('HDR grading and color management', '◐ **new** (Rec. 2020 PQ/HLG, no ACES)')
st('Node compositor (Fusion-like)', '✅ **new**')


def rep(a, b):
    global s
    assert a in s, a[:60]
    s = s.replace(a, b, 1)


rep('''|     | Before this round | After this round |
| --- | ----------------- | ---------------- |
| ✅  | 51                | 66               |
| ◐   | 4                 | 6                |
| ❌  | 23                | 6                |''', '''|     | Before this round | After this round |
| --- | ----------------- | ---------------- |
| ✅  | 66                | 70               |
| ◐   | 6                 | 6                |
| ❌  | 6                 | 2                |''')

old_still = s[s.index('Still ❌: generative AI'): s.index('See "What is left" below.')]
rep(old_still, '''Still ❌: generative AI (extend, voices, dubbing, eye contact) and client
review links. Still ◐: publishing (YouTube and Vimeo; not TikTok or Facebook),
camera RAW (converted first), the native GPU engine (offered, not the default),
HDR (Rec. 2020 PQ and HLG timelines, scopes in nits and HDR10/HLG export, but
no ACES), plug-ins (VST3 effects on sound clips, run in a separate process so a
crash can't take the edit down; no Audio Units, none on tracks or buses yet,
and the plug-in's own window opens only on Windows) and automatic B-roll (from
your own media, not a stock library). ''')

rep('''| Automatic B-roll                                       | Needs a stock library, or a reliable index of what each of your own shots shows; media search is the start of it.                                |
| Who is speaking on a single microphone                 | Needs a voice model to tell voices apart; today speakers are told apart by microphone or file.                                                   |
| A neural voice isolation model                         | Voice isolation uses noise-following filters today; a bundled model (as Resolve and Premiere ship) would be cleaner on hard recordings.          |
''', '''| B-roll from a stock library                            | B-roll comes from your own media, found by what is said; a stock library needs a licensed catalog and an account.                                |
''')
rep('''| HDR grading and color management                       | HDR files are shown and exported as SDR today; a color-managed pipeline (Rec. 2020, PQ/HLG out) is a larger change to the compositor.            |
| VST plug-ins, a node compositor                        | Large native projects (a plug-in host; a node graph and its viewer).                                                                             |
''', '''| ACES color management                                  | HDR sequences work in Rec. 2020 PQ or HLG from end to end; ACES (and its camera input transforms) is a further step.                             |
| VST3 on tracks and buses, Audio Units                  | VST3 effects run on clips today, rendered in a helper process; live effects on tracks need a real-time audio engine, Audio Units need macOS.     |
''')
open(p, 'w').write(s)
