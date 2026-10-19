import sys
p = sys.argv[1] + '/docs/COMPETITORS-STUDIO.md'
s = open(p).read()


def rep(a, b):
    global s
    assert a in s, a[:70]
    s = s.replace(a, b, 1)


rep('| Hand-drawn masks (Studio: straight-sided shapes, not animated) and rotoscoping                    | ◐ **new**  |',
    '| Hand-drawn masks and rotoscoping (Studio: straight-sided points, animated) | ✅ **new** |')
rep('| ✅  | 51                | 65               |', '| ✅  | 51                | 66               |')
rep('| ◐   | 4                 | 6                |', '| ◐   | 4                 | 5                |')
rep('''on one microphone), voice isolation (filters, not a neural model), hand-drawn
masks (straight-sided, not animated), camera RAW (converted first) and the
native GPU engine (offered, not the default).''', '''on one microphone), voice isolation (filters, not a neural model), camera RAW
(converted first) and the native GPU engine (offered, not the default).''')
rep('''| Animated hand-drawn masks (rotoscoping)                    | Drawn masks are fixed shapes on the frame; points that move over time, or follow a track, are next.                                      |''',
    '''| Curved (bezier) mask edges, masks that follow a track | Drawn masks use straight-sided points (many points make a curve) and are animated by hand; bezier handles and following a motion track are next. |''')
open(p, 'w').write(s)
