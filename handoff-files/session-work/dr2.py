import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
def rep(p, old, new):
    s = open(p).read()
    assert old in s, (p, old)
    s = s.replace(old, new, 1)
    open(p, 'w').write(s)

# The screens and previews.
p = 'app/src/components/SourceView.tsx'
rep(p, """    case 'comment':
      return <CommentView c={k} />;""", """    case 'comment':
      return <CommentView c={k} />;
    case 'drawing':
      return <DrawingView d={k} />;""")
s = open(p).read()
i = s.index('\nimport ')
s = s[:i] + "\nimport { DrawingView } from './DrawingView';" + s[i:]
open(p, 'w').write(s)

# The recording and the unified engine's overlay renderer.
p = 'app/src/broadcast/compositor.ts'
rep(p, """      case 'comment':
        this.comment(k, now, w, h);
        return;""", """      case 'comment':
        this.comment(k, now, w, h);
        return;
      case 'drawing':
        paintDrawing(this.ctx, k, w, h);
        return;""")
s = open(p).read()
i = s.index('\nimport ')
s = s[:i] + "\nimport { paintDrawing } from '../engine/drawing';" + s[i:]
open(p, 'w').write(s)

# The browser mirror of the engine.
p = 'app/src/engine/demo.ts'
rep(p, """    case 'setQuickMessage':""", """    case 'drawStroke':
    case 'drawUndo':
    case 'drawClear': {
      const src = s.sources.find((x) => x.id === a.id);
      if (!src) throw new Refused({ code: 'unknownSource', id: a.id });
      if (src.kind.type !== 'drawing') throw new Refused({ code: 'invalidValue', field: 'id', reason: 'that input is not for drawing' });
      const d = src.kind;
      if (a.type === 'drawStroke') addStroke(d, a.stroke, now);
      else if (a.type === 'drawUndo') {
        if (d.strokes.pop()) d.changedAt = now;
      } else if (d.strokes.length) {
        d.strokes = [];
        d.changedAt = now;
      }
      return;
    }
    case 'setQuickMessage':""")
s = open(p).read()
i = s.index('\nimport ')
s = s[:i] + "\nimport { addStroke } from './drawing';" + s[i:]
open(p, 'w').write(s)

p = 'app/src/views/InputGrid.tsx'
rep(p, """  comment: 'Chat comment',""", """  comment: 'Chat comment',
  drawing: 'Drawing',""")
p = 'app/src/views/kindIcons.ts'
rep(p, """  comment: MessageSquareText,""", """  comment: MessageSquareText,
  drawing: PenLine,""")
p = 'app/src/engine/overlays.ts'
rep(p, """export const OVERLAY_KINDS: ReadonlySet<string> = new Set(['text', 'scoreboard', 'graphic', 'titler', 'comment', 'lyrics']);""",
"""export const OVERLAY_KINDS: ReadonlySet<string> = new Set(['text', 'scoreboard', 'graphic', 'titler', 'comment', 'lyrics', 'drawing']);""")
p = 'app/src/views/AddInput.tsx'
rep(p, """  { kind: 'poll', name: 'Audience poll',""", """  { kind: 'drawing', name: 'Drawing on screen', hint: 'Draw lines and arrows over the picture, live (a telestrator)' },
  { kind: 'poll', name: 'Audience poll',""")
rep(p, """    kinds: ['text', 'titler', 'graphic', 'credits', 'lyrics', 'countdown', 'scoreboard', 'comment', 'pesukim', 'scripture', 'zmanim'],""",
"""    kinds: ['text', 'titler', 'graphic', 'credits', 'lyrics', 'countdown', 'scoreboard', 'comment', 'drawing', 'pesukim', 'scripture', 'zmanim'],""")
rep(p, """      case 'comment':
        return { name: n || 'Chat comments',""", """      case 'drawing':
        return { name: n || 'Drawing', kind: { type: 'drawing', strokes: [], changedAt: 0 } };
      case 'comment':
        return { name: n || 'Chat comments',""")
