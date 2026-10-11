// Docked panels: each side of the canvas holds one to three groups of panels,
// stacked; a group shows its panels as tabs. A tab dragged onto another
// group's tabs joins that group; dropped on the top or bottom of a group it
// makes a new group there; dropped on the other side's edge it opens a new
// group on that side. The line between two groups is dragged to share the
// height. Dragging with the pointer; the keyboard moves a panel with
// Alt+Shift+Left/Right (to the other side).

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { findPanel, movePanel, PANEL_NAMES, resizeGroups, showPanel, type DockTarget, type Docks, type PanelId, type Side } from './workspace';

interface Drag {
  id: PanelId;
  x: number;
  y: number;
  target: DockTarget | null;
  /** Where to draw the drop marker (viewport px). */
  mark: { x: number; y: number; w: number; h: number; line?: boolean } | null;
}

/** The drag of a panel tab, shared by both sides (one at a time). */
export function useDockDrag(docks: Docks, onDocks: (d: Docks) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const latest = useRef({ docks, onDocks });
  latest.current = { docks, onDocks };

  const begin = (e: React.PointerEvent, id: PanelId) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let started = false;
    let cur: Drag | null = null;
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      started = true;
      const hit = targetAt(ev.clientX, ev.clientY, latest.current.docks);
      cur = { id, x: ev.clientX, y: ev.clientY, target: hit?.target ?? null, mark: hit?.mark ?? null };
      setDrag(cur);
    };
    const end = (drop: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
      if (started && drop && cur?.target) latest.current.onDocks(movePanel(latest.current.docks, id, cur.target));
      setDrag(null);
    };
    const up = () => end(true);
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && started) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        end(false);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key, true);
  };
  return { drag, begin };
}

/** What is under the pointer while a panel is dragged. */
function targetAt(x: number, y: number, docks: Docks): { target: DockTarget; mark: Drag['mark'] } | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const zone = el?.closest<HTMLElement>('[data-dock]');
  if (!zone) return null;
  const side = zone.dataset.side as Side;
  const kind = zone.dataset.dock;
  const r = zone.getBoundingClientRect();
  if (kind === 'side') return { target: { kind: 'side', side }, mark: { x: r.left, y: r.top, w: r.width, h: r.height } };
  const group = Number(zone.dataset.group);
  if (kind === 'tabs') {
    const tabs = [...zone.querySelectorAll<HTMLElement>('[data-tab]')];
    let index = tabs.length;
    for (let i = 0; i < tabs.length; i++) {
      const b = tabs[i]!.getBoundingClientRect();
      if (x < b.left + b.width / 2) {
        index = i;
        break;
      }
    }
    const ref = tabs[index]?.getBoundingClientRect();
    const last = tabs[tabs.length - 1]?.getBoundingClientRect();
    const lx = ref ? ref.left - 1 : last ? last.right + 1 : r.left + 4;
    return { target: { kind: 'tabs', side, group, index }, mark: { x: lx - 1, y: r.top + 4, w: 2, h: r.height - 8, line: true } };
  }
  // A group's body: the top or bottom quarter makes a new group there (room allowing), elsewhere it joins.
  const full = docks[side].length >= 3;
  const f = (y - r.top) / Math.max(1, r.height);
  if (!full && f < 0.28) return { target: { kind: 'split', side, group, where: 'before' }, mark: { x: r.left, y: r.top, w: r.width, h: r.height / 2 } };
  if (!full && f > 0.72) return { target: { kind: 'split', side, group, where: 'after' }, mark: { x: r.left, y: r.top + r.height / 2, w: r.width, h: r.height / 2 } };
  return { target: { kind: 'tabs', side, group, index: docks[side][group]?.tabs.length ?? 0 }, mark: { x: r.left, y: r.top, w: r.width, h: r.height } };
}

/** One side's panels. */
export function DockSide({
  side,
  docks,
  onDocks,
  render,
  dragging,
  begin,
  children,
}: {
  side: Side;
  docks: Docks;
  onDocks: (d: Docks) => void;
  render: (id: PanelId) => ReactNode;
  dragging: boolean;
  begin: (e: React.PointerEvent, id: PanelId) => void;
  /** The side's own extras (its width splitter). */
  children?: ReactNode;
}) {
  const groups = docks[side];
  const box = useRef<HTMLDivElement>(null);
  const total = groups.reduce((a, x) => a + x.size, 0) || 1;
  return (
    <aside className={`tt-${side} tt-dock${dragging ? ' tt-dragging' : ''}`} ref={box} aria-label={side === 'left' ? 'Left panels' : 'Right panels'}>
      {groups.map((grp, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <GroupSplitter
              label={`Resize the panels ${PANEL_NAMES[groups[i - 1]!.active]} and ${PANEL_NAMES[grp.active]}`}
              onShare={(share) => onDocks(resizeGroups(docks, side, i - 1, share))}
              pair={() => {
                const els = box.current?.querySelectorAll<HTMLElement>(':scope > .tt-dock-group');
                return [els?.[i - 1]?.getBoundingClientRect(), els?.[i]?.getBoundingClientRect()];
              }}
            />
          )}
          <section className="tt-dock-group" style={{ flexGrow: grp.size / total, flexBasis: 0 }} aria-label={`${PANEL_NAMES[grp.active]} panel`}>
            <div className="tt-tabs" role="tablist" data-dock="tabs" data-side={side} data-group={i}>
              {grp.tabs.map((id) => (
                <button
                  key={id}
                  role="tab"
                  data-tab={id}
                  aria-selected={grp.active === id}
                  className={grp.active === id ? 'on' : ''}
                  title={`${PANEL_NAMES[id]}: drag the tab to dock it elsewhere`}
                  onPointerDown={(e) => begin(e, id)}
                  onClick={() => onDocks(showPanel(docks, id))}
                  onKeyDown={(e) => {
                    // Alt+Shift+arrow: the panel to the other side.
                    if (!(e.altKey && e.shiftKey) || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
                    e.preventDefault();
                    const to: Side = e.key === 'ArrowLeft' ? 'left' : 'right';
                    if (findPanel(docks, id)?.side === to) return;
                    onDocks(movePanel(docks, id, docks[to].length ? { kind: 'tabs', side: to, group: 0, index: docks[to][0]!.tabs.length } : { kind: 'side', side: to }));
                  }}
                >
                  {PANEL_NAMES[id]}
                </button>
              ))}
            </div>
            <div className="tt-dock-body" role="tabpanel" aria-label={PANEL_NAMES[grp.active]} data-dock="body" data-side={side} data-group={i}>
              {render(grp.active)}
            </div>
          </section>
        </Fragment>
      ))}
      {children}
    </aside>
  );
}

/** While a panel is dragged: the marker where it would go, the tab under the pointer, and the edges of an empty side. */
export function DockOverlay({ drag, docks }: { drag: Drag | null; docks: Docks }) {
  if (!drag) return null;
  return (
    <>
      {(['left', 'right'] as const)
        .filter((s) => !docks[s].length)
        .map((s) => (
          <div key={s} className={`tt-dock-edge ${s}`} data-dock="side" data-side={s} aria-hidden="true">
            <span>Dock here</span>
          </div>
        ))}
      {drag.mark && (
        <div
          className={`tt-dock-mark${drag.mark.line ? ' line' : ''}`}
          style={{ left: drag.mark.x, top: drag.mark.y, width: drag.mark.w, height: drag.mark.h }}
          aria-hidden="true"
        />
      )}
      <div className="tt-dock-ghost" style={{ left: drag.x + 12, top: drag.y + 10 }} aria-hidden="true">
        {PANEL_NAMES[drag.id]}
      </div>
    </>
  );
}

function GroupSplitter({ label, onShare, pair }: { label: string; onShare: (share: number) => void; pair: () => (DOMRect | undefined)[] }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!active) return;
    const up = () => setActive(false);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [active]);
  const shareAt = (y: number) => {
    const [a, b] = pair();
    if (!a || !b) return null;
    return (y - a.top) / Math.max(1, b.bottom - a.top);
  };
  return (
    <div
      className={`tt-dock-split${active ? ' on' : ''}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const [a, b] = pair();
        if (!a || !b) return;
        const share = (a.height + (e.key === 'ArrowDown' ? 16 : -16)) / Math.max(1, a.height + b.height);
        onShare(share);
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        setActive(true);
        const move = (ev: PointerEvent) => {
          const s = shareAt(ev.clientY);
          if (s !== null) onShare(s);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    />
  );
}
