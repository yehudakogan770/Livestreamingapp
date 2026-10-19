import sys
root = sys.argv[1]
p = root + '/docs/COMPETITORS-STUDIO.md'
s = open(p).read()


def rep(a, b):
    global s
    assert a in s, a[:70]
    s = s.replace(a, b, 1)


rep("| Line files up by timecode | ❌ |", "| Line files up by timecode (or recording time) | ✅ **new** |")
rep("| Rough cut from a written script | ❌ |", "| Rough cut from a written script, other takes kept | ✅ **new** |")
rep("| Track volume automation (fader moves over time) | ◐ (clip volume lines) |", "| Track volume automation (record fader moves) | ✅ **new** |")
rep("| Record a voiceover onto the timeline | ❌ |", "| Record a voiceover onto the timeline | ✅ **new** |")
rep("| Hand-drawn (bezier) masks and rotoscoping | ❌ |", "| Hand-drawn masks (Studio: straight-sided shapes, not animated) and rotoscoping | ◐ **new** |")
rep("| Animated title designer with templates and data | ✅ (Lumora Titler) |", "| Animated title designer with templates and data (Studio: 45 motion templates and the Titler's 24) | ✅ **new** |")
open(p, 'w').write(s)
