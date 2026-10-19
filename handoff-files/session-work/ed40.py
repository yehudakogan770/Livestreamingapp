import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='props.ts'; s=open(p).read()
a='''export function layerKeyTimes(l: Layer): number[] {
  const out = new Set<number>();
  for (const pi of propsOf(l)) {
    const p = getProp(l, pi.path);
    if (isAnimated(p)) for (const k of p.k) out.add(Math.round(k.t * 1000) / 1000);
  }'''
assert a in s
s=s.replace(a,a+'''
  // Masks and paths changing form.
  for (const m of l.masks ?? []) for (const k of m.morph ?? []) out.add(Math.round(k.t * 1000) / 1000);
  if (l.type === 'shape') for (const k of l.morph ?? []) out.add(Math.round(k.t * 1000) / 1000);''')
open(p,'w').write(s)

p='Timeline.tsx'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''              graph={graph}
            />,
          );
      }''','''              graph={graph}
            />,
          );
        // Masks and paths changing form: their keys.
        for (const ref of outlineRefs(l))
          if (isMorphing(l, ref))
            rows.push(<OutlineRow key={`${l.id}:outline:${ref.kind === 'mask' ? ref.index : 'path'}`} store={store} c={c} l={l} outline={ref} depth={depth} x={x} keys={keys} dragTime={dragTime} />);
      }''')
rep('''/** Move keyframes in time (from the project as it was when the drag started). */''','''/** The keys of a mask or path changing form: dragged in time, clicked to go there. */
function OutlineRow({ store, c, l, outline, depth, x, dragTime }: RowProps & { outline: OutlineRef }) {
  const label = outline.kind === 'mask' ? `${l.masks?.[outline.index]?.name ?? 'Mask'}: shape` : 'Outline';
  return (
    <div className="tt-row prop" style={{ height: ROW }}>
      <div className="tt-tl-left" style={{ paddingLeft: 22 + depth * 14 }}>
        <span className="tt-ico on" aria-hidden="true">
          <Clock size={12} />
        </span>
        <span className="tt-propname">{label}</span>
      </div>
      <div className="tt-tl-track">
        {outlineKeyTimes(l, outline).map((t) => (
          <span
            key={t}
            className="tt-key"
            style={{ left: x(t) }}
            title={`${label} at ${t.toFixed(2)} s (drag to move; double-click to go there)`}
            onDoubleClick={() => store.set({ time: t, cue: null })}
            onPointerDown={(e) => {
              const start = store.get().project;
              dragTime(e, 'Move key', (dt) =>
                store.edit('Move key', () => updateLayers(start, c.id, [l.id], (y) => moveOutlineKey(y, outline, t, Math.min(c.duration, Math.max(0, t + dt))))),
              );
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Move keyframes in time (from the project as it was when the drag started). */''')
rep("import { NumberField } from './fields';","import { NumberField } from './fields';\nimport { isMorphing, moveOutlineKey, outlineKeyTimes, outlineRefs, type OutlineRef } from './outlines';")
open(p,'w').write(s)
