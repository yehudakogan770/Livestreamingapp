import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='outlines.ts'; s=open(p).read()
s=s.replace('''/** An outline fitted to another box (points and handles scaled; for typing a mask's place and size). */
export function fitOutline(o: PathData, box: { x: number; y: number; w: number; h: number }): PathData {
  const b = pathBounds(o);''','''/** Where outlines are together: the box around their points. */
export function outlinesBox(list: PathData[]): { x: number; y: number; w: number; h: number } {
  const bs = list.filter((o) => o.v.length).map(pathBounds);
  if (!bs.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}

/** Outlines fitted together to another box (for typing a mask's or a path's place and size). */
export function fitOutlines(list: PathData[], box: { x: number; y: number; w: number; h: number }): PathData[] {
  const b = outlinesBox(list);
  return list.map((o) => fitOutline(o, box, b));
}

/** An outline fitted to another box (points and handles scaled), from its own box or the one given. */
export function fitOutline(o: PathData, box: { x: number; y: number; w: number; h: number }, from = pathBounds(o)): PathData {
  const b = from;''')
open(p,'w').write(s)

p='Inspector.tsx'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''      {l.shape === 'path' && (
        <div className="tt-dim tt-small">
          Drawn with the pen: {l.path?.v.length ?? 0} points, {l.path?.closed ? 'closed' : 'open'}.
        </div>
      )}''','''      {l.shape === 'path' && (
        <>
          <div className="tt-dim tt-small">
            {l.path?.v.length ?? 0} points, {l.path?.closed ? 'closed' : 'open'}. Double-click it on the canvas to move its points and their handles.
          </div>
          <OutlineControls store={store} l={l} compId={compId} outline={{ kind: 'path' }} label="Outline" />
        </>
      )}''')
rep('''          <Row label="Feather">
            <NumberField
              value={valueAt(m.feather as never, 0, 0 as never) as number}''','''          <OutlineControls store={store} l={l} compId={compId} outline={{ kind: 'mask', index: i }} label="Shape" />
          <Row label="Feather">
            <NumberField
              value={valueAt(m.feather as never, 0, 0 as never) as number}''')
rep('''function EffectSection({''','''/**
 * An outline's place and size typed in, its change of form over time (the
 * stopwatch: a key at the playhead; then each edit at the playhead sets the
 * key there), stepping between its keys, and editing its points on the canvas.
 */
function OutlineControls({ store, l, compId, outline, label }: { store: Store; l: Layer; compId: string; outline: OutlineRef; label: string }) {
  const time = useStore(store, (s) => s.time);
  const editing = useStore(store, (s) => s.editingPath === l.id);
  const upd = (name: string, fn: (x: Layer) => Layer) => store.edit(name, (p) => updateLayers(p, compId, [l.id], fn));
  const list = outlinesAt(l, outline, time);
  if (!list.length) return null;
  const b = outlinesBox(list);
  const morphing = isMorphing(l, outline);
  const keys = outlineKeyTimes(l, outline);
  const keyHere = keys.some((k) => Math.abs(k - time) < 1e-4);
  const what = outline.kind === 'mask' ? 'mask' : 'outline';
  const setBox = (patch: Partial<typeof b>) => upd(`Change ${what}`, (x) => setOutlinesAt(x, outline, time, fitOutlines(outlinesAt(x, outline, time), { ...b, ...patch })));
  const jump = (dir: -1 | 1) => {
    const next = dir > 0 ? keys.find((k) => k > time + 1e-4) : [...keys].reverse().find((k) => k < time - 1e-4);
    if (next !== undefined) store.set({ time: next, cue: null });
  };
  return (
    <>
      <Row label={label} hint={morphing ? 'Changes form over time: an edit at the playhead sets the key there' : 'Click the stopwatch to change its form over time'}>
        <button
          className={`tt-ico${morphing ? ' on' : ''}`}
          aria-pressed={morphing}
          aria-label={`Animate the ${what}`}
          title={morphing ? `Stop animating the ${what} (keeps its form here)` : `Animate the ${what} (a key here)`}
          onClick={() => upd(morphing ? `Stop animating the ${what}` : `Animate the ${what}`, (x) => animateOutline(x, outline, time, !morphing))}
        >
          <Clock size={12} />
        </button>
        {morphing && (
          <span className="tt-keynav">
            <button className="tt-ico" aria-label={`Previous ${what} key`} title="Previous key" onClick={() => jump(-1)}>
              <ChevronLeft size={12} />
            </button>
            <button
              className={`tt-ico${keyHere ? ' on' : ''}`}
              aria-label={keyHere ? `Remove the ${what} key here` : `Add a ${what} key here`}
              title={keyHere ? 'Remove the key here' : 'A key here'}
              onClick={() =>
                upd(keyHere ? `Remove ${what} key` : `Add ${what} key`, (x) => (keyHere ? removeOutlineKey(x, outline, time) : setOutlinesAt(x, outline, time, outlinesAt(x, outline, time))))
              }
            >
              <Diamond size={10} />
            </button>
            <button className="tt-ico" aria-label={`Next ${what} key`} title="Next key" onClick={() => jump(1)}>
              <ChevronRight size={12} />
            </button>
            <span className="tt-dim tt-small">
              {keys.length} key{keys.length === 1 ? '' : 's'}
            </span>
          </span>
        )}
        {outline.kind === 'path' && (
          <button
            className={`tt-btn${editing ? ' on' : ''}`}
            onClick={() => store.set(editing ? { editingPath: null, outlinePoint: null } : { editingPath: l.id, outlinePoint: null, tool: 'select' })}
            aria-pressed={editing}
          >
            {editing ? 'Done' : 'Edit points'}
          </button>
        )}
      </Row>
      <Row label="Box" hint={`The ${what}'s place and size (in the layer), px`}>
        <NumberField value={Math.round(b.x * 10) / 10} label={`${label} x`} onChange={(x) => setBox({ x })} onBegin={() => store.begin(`Change ${what}`)} onEnd={() => store.end()} />
        <NumberField value={Math.round(b.y * 10) / 10} label={`${label} y`} onChange={(y) => setBox({ y })} onBegin={() => store.begin(`Change ${what}`)} onEnd={() => store.end()} />
        <NumberField value={Math.round(b.w * 10) / 10} min={1} label={`${label} width`} onChange={(w) => setBox({ w: Math.max(1, w) })} onBegin={() => store.begin(`Change ${what}`)} onEnd={() => store.end()} />
        <NumberField value={Math.round(b.h * 10) / 10} min={1} label={`${label} height`} onChange={(h) => setBox({ h: Math.max(1, h) })} onBegin={() => store.begin(`Change ${what}`)} onEnd={() => store.end()} />
      </Row>
    </>
  );
}

function EffectSection({''')
rep("import { askText } from './Modal';","import { askText } from './Modal';\nimport { animateOutline, isMorphing, outlineKeyTimes, outlinesAt, outlinesBox, fitOutlines, removeOutlineKey, setOutlinesAt, type OutlineRef } from './outlines';")
rep("import { Plus, Trash2 } from 'lucide-react';","import { ChevronLeft, ChevronRight, Clock, Diamond, Plus, Trash2 } from 'lucide-react';")
open(p,'w').write(s)
