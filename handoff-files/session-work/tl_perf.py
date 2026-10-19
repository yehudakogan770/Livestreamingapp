import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

edit('titler/src/designer/Timeline.tsx', [
("""  const x = (t: number) => t * zoom;
  const tAt = (clientX: number) => {""", """  // Stable while only the playhead moves, so the rows (memoized) aren't drawn again 60 times a second.
  const x = useCallback((t: number) => t * zoom, [zoom]);
  const tAt = (clientX: number) => {"""),
("""  /** Drag something in time: `fn` gets the time moved (seconds, snapped to frames). */
  const dragTime = (e: React.PointerEvent, label: string, fn: (dt: number, ev: PointerEvent) => void) => {
    e.stopPropagation();
    const t0 = tAt(e.clientX);
    store.begin(label);
    const move = (ev: PointerEvent) => fn(frame(tAt(ev.clientX)) - frame(t0), ev);""", """  /** Drag something in time: `fn` gets the time moved (seconds, snapped to frames). */
  const latest = useRef({ tAt, frame });
  latest.current = { tAt, frame };
  const dragTime = useCallback((e: React.PointerEvent, label: string, fn: (dt: number, ev: PointerEvent) => void) => {
    e.stopPropagation();
    const { tAt, frame } = latest.current;
    const t0 = tAt(e.clientX);
    store.begin(label);
    const move = (ev: PointerEvent) => fn(frame(tAt(ev.clientX)) - frame(t0), ev);"""),
("""    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const setMarkers""", """    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [store]);

  const setMarkers"""),
("""function LayerRow({ store, c, l, depth, x, selected, open, dragTime }: RowProps & { selected: boolean; open: 'all' | 'animated' | undefined }) {""",
 """const LayerRow = memo(function LayerRow({
  store,
  c,
  l,
  depth,
  x,
  selected,
  open,
  dragTime,
}: RowProps & { selected: boolean; open: 'all' | 'animated' | undefined }) {"""),
("import { useEffect, useRef, useState, type ReactNode } from 'react';", "import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';"),
])
# close the memo( … ) of LayerRow: find the end of the function (the line before "function PropRow").
p = 'titler/src/designer/Timeline.tsx'
s = open(p).read()
i = s.index('const LayerRow = memo(function LayerRow(')
j = s.index('\nfunction PropRow(', i)
body = s[i:j]
k = body.rstrip().rfind('\n}')
body = body[:k] + '\n});' + body[k + 2:]
s = s[:i] + body + s[j:]
open(p, 'w').write(s)
print('ok')
