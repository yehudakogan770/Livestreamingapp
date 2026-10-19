import sys
root = sys.argv[1]


def edit(path, pairs):
    p = root + '/' + path
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (path, a[:70])
        s = s.replace(a, b, 1)
    open(p, 'w').write(s)


edit('editor/app/src/ui/Tracking.tsx', [
    ("""  if (effect.type === 'personmask' || effect.type === 'objectmask') return <AiMaskRows doc={doc} engine={engine} clip={clip} effect={effect} local={local} />;""",
     """  if (effect.type === 'personmask' || effect.type === 'objectmask') return <AiMaskRows doc={doc} engine={engine} clip={clip} effect={effect} local={local} />;
  if (effect.type === 'drawnmask') return <DrawnMaskRows doc={doc} clip={clip.id} effect={effect} />;"""),
])
p = root + '/editor/app/src/ui/Tracking.tsx'
s = open(p).read()
i = s.index('import ')
s = s[:i] + "import { DrawnMaskRows } from './DrawMask';\n" + s[i:]
open(p, 'w').write(s)

edit('editor/app/src/ui/Monitors.tsx', [
    ("""          <CompareOverlay />""", """          <CompareOverlay />
          <DrawMaskOverlay doc={doc} />"""),
    ("""  nativePlayback.blocked = u.safeMargins || expo.mode !== 'off' || !!cmp.showing || (!playing && !!moving) || !!problem;""",
     """  nativePlayback.blocked = u.safeMargins || expo.mode !== 'off' || !!cmp.showing || !!drawingMask || (!playing && !!moving) || !!problem;"""),
    ("""  const cmp = useCompare();""", """  const cmp = useCompare();
  const drawingMask = useDrawing();"""),
    ("""import { CompareOverlay, StillsButton, useCompare } from './Compare';""", """import { CompareOverlay, StillsButton, useCompare } from './Compare';
import { DrawMaskOverlay, useDrawing } from './DrawMask';"""),
])

open(root + '/editor/app/src/editor.css', 'a').write('''.dmask {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: crosshair;
  touch-action: none;
}
.dmask__shape {
  fill: rgba(224, 151, 63, 0.12);
  stroke: var(--accent);
  stroke-width: 1.5;
}
.dmask__shape.is-open {
  fill: none;
  stroke-dasharray: 4 3;
}
.dmask__pt {
  fill: #ffffff;
  stroke: var(--accent);
  stroke-width: 1.5;
  cursor: move;
}
''')
