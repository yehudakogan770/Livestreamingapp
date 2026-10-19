import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
p = 'docs/FEATURES.md'
s = open(p).read()
old = "5. 🔶 **Live chat and comments on screen** from YouTube / Facebook / Twitch (StreamYard, Restream, Streamlabs). YouTube and Twitch done; ⬜ Facebook."
new = "5. ✅ **Live chat and comments on screen** from YouTube / Facebook / Twitch (StreamYard, Restream, Streamlabs). Facebook reads the comments of the live video made through the connected account; viewers' support (Super Chats, members, subscribers, bits, raids) is marked and can be thanked on screen by itself."
assert old in s
s = s.replace(old, new, 1)
anchor = s.index("36. ✅ **On-screen effects**")
end = s.index("\n", anchor)
add = """
37. ✅ **Marks while recording** — Mark (next to REC, or M, a macro step, the Stream Deck or /api/do/mark) marks the moment in the event file straight away; “Keep as a highlight” marks too; Lumora Studio shows every mark on its timeline (ATEM markers, Riverside clips).
38. ✅ **More triggers** — a video about to end (vMix OnPlaybackTime), an input losing its picture or getting it back, sound louder or quieter than a level for a while (Advanced Scene Switcher), recording or the stream starting or stopping, every few minutes.
39. ✅ **Event templates** — the first event setup asks what kind of event it is (Conference, Concert, Wedding, Sports, Panel, Webinar, or empty) and adds its inputs, Monitor messages and a run of show.
40. ✅ **Speaker timing** (Stagetimer) — on the Monitor the time left turns amber to wrap up and red in the last minute, shows the time over after zero (+1:05) and a bar of the time gone; the speaker's phone shows the same, with the Monitor message.
41. ✅ **Find any command by typing** (Ctrl+K) — every menu command and the show's inputs, presets, macros and overlays, run from the keyboard alone (Lumora only).
42. ✅ **Drawing on screen** (vMix telestrator, TriCaster) — lines, dots and arrows over the picture on an overlay, drawn on a pad over the live picture, the same on every screen and in the recording.
43. ✅ **Twitch, Kick, LinkedIn and X** in the list of streaming services.
44. ⬜ This computer's sound or one app's sound (WASAPI loopback), VST plugins, a virtual camera of Lumora's own (until then NDI out with NDI Webcam), per-output size. See docs/COMPETITORS-LUMORA.md."""
s = s[:end] + add + s[end:]
open(p, 'w').write(s)
