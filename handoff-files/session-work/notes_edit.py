import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

edit('titler/src/core/types.ts', [
("""  /** The title's own color swatches ("#rrggbb[aa]"). */
  swatches?: string[];""", """  /** The title's own color swatches ("#rrggbb[aa]"). */
  swatches?: string[];
  /** Notes pinned on the canvas (for the people working on the title; never drawn on air). */
  notes?: CanvasNote[];"""),
("""/** A text style shared across the title (layers linked to it follow it). */""", """/** A note pinned to a place on a composition's canvas. */
export interface CanvasNote {
  id: string;
  comp: string;
  /** Composition pixels. */
  x: number;
  y: number;
  text: string;
  /** Who wrote it (optional) and when. */
  by?: string;
  at: number;
  done?: boolean;
}

/** A text style shared across the title (layers linked to it follow it). */"""),
])

edit('titler/src/designer/store.ts', [
("export type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'pen' | 'hand';", "export type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'pen' | 'hand' | 'note';"),
("  show: { safe: boolean; guides: boolean; grid: boolean; rulers: boolean; snap: boolean; motionPaths: boolean };", "  show: { safe: boolean; guides: boolean; grid: boolean; rulers: boolean; snap: boolean; motionPaths: boolean; notes: boolean };\n  /** The note being written (its id). */\n  editingNote?: string | null;"),
("      show: { safe: true, guides: true, grid: false, rulers: true, snap: true, motionPaths: true },", "      show: { safe: true, guides: true, grid: false, rulers: true, snap: true, motionPaths: true, notes: true },"),
])

edit('titler/src/designer/Viewport.tsx', [
("""    if (s.show.rulers) drawRulers(ctx, W, H, scale, ox, oy, col);
  }, [store, env, size, ram]);""", """    if (s.show.notes) {
      // Notes pinned on the canvas: numbered tags (open ones solid, done ones outlined).
      (s.project.notes ?? [])
        .filter((n) => n.comp === c.id)
        .forEach((n, i) => {
          const [x, y] = P([n.x, n.y]);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.arc(x + 11, y - 11, 10, Math.PI * 0.6, Math.PI * 2.4);
          ctx.closePath();
          ctx.fillStyle = n.done ? 'rgba(40,40,38,0.9)' : n.id === s.editingNote ? '#f2c94c' : '#e8b931';
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 1;
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = n.done ? '#bbb' : '#111';
          ctx.font = '600 10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(i + 1), x + 11, y - 11);
          ctx.restore();
        });
    }
    if (s.show.rulers) drawRulers(ctx, W, H, scale, ox, oy, col);
  }, [store, env, size, ram]);"""),
("""    if (tool === 'text') {
      const l = newText(c, 'Text', [Math.round(p[0]), Math.round(p[1])], [800, 90]);""", """    if (tool === 'note') {
      const note: CanvasNote = { id: `n${Date.now().toString(36)}`, comp: c.id, x: Math.round(p[0]), y: Math.round(p[1]), text: '', at: Date.now() };
      store.edit('Add note', (pr) => ({ ...pr, notes: [...(pr.notes ?? []), note] }), { tool: 'select', editingNote: note.id });
      return;
    }
    if (s.show.notes && tool === 'select') {
      // A click on a note's tag opens it.
      const hit = (s.project.notes ?? []).find((n) => n.comp === c.id && dist([n.x + 11 / view.current.scale, n.y - 11 / view.current.scale], p) * view.current.scale < 11);
      if (hit) {
        store.set({ editingNote: hit.id });
        return;
      }
    }
    if (tool === 'text') {
      const l = newText(c, 'Text', [Math.round(p[0]), Math.round(p[1])], [800, 90]);"""),
("import type { Layer, PathVertex, Vec2 } from '../core/types';", "import type { CanvasNote, Layer, PathVertex, Vec2 } from '../core/types';"),
])

edit('titler/src/designer/Designer.tsx', [
("""    ['hand', 'Hand (move the view)', <Hand key="h" size={16} />, 'H'],
  ];""", """    ['hand', 'Hand (move the view)', <Hand key="h" size={16} />, 'H'],
    ['note', 'Note (pin a note on the canvas)', <MessageSquare key="n" size={16} />, 'N'],
  ];"""),
("""                ['motionPaths', 'Motion paths'],
              ] as const""", """                ['motionPaths', 'Motion paths'],
                ['notes', 'Notes'],
              ] as const"""),
("""  Maximize2,
  Minimize2,
} from 'lucide-react';""", """  Maximize2,
  Minimize2,
  MessageSquare,
} from 'lucide-react';"""),
("""        <section className="tt-center">""", """        <NotesPopover store={store} />
        <section className="tt-center">"""),
("import { HistoryPanel } from './HistoryPanel';", "import { HistoryPanel } from './HistoryPanel';\nimport { NotesPanel, NotesPopover } from './Notes';"),
("""          {side === 'history' && <HistoryPanel store={store} />}""", """          {side === 'history' && (
            <>
              <NotesPanel store={store} />
              <HistoryPanel store={store} />
            </>
          )}"""),
])
print('ok')
