import { Eraser, MoveUpRight, PenLine, Undo2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { DrawingView } from '../components/DrawingView';
import { ProgramView } from '../components/ScreenView';
import { PEN_COLORS, PEN_WIDTHS, thin } from '../engine/drawing';
import type { EngineClient } from '../engine/client';
import type { Drawing } from '../engine/types/Drawing';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import type { Stroke } from '../engine/types/Stroke';
import type { Act } from './act';
import './PesukimCard.css';
import './DrawingCard.css';

const COLOR_NAMES: Record<string, string> = {
  '#ffd400': 'Yellow',
  '#ff3b30': 'Red',
  '#ffffff': 'White',
  '#2f80ed': 'Blue',
  '#34c759': 'Green',
  '#000000': 'Black',
};
const WIDTH_NAMES = ['Thin', 'Medium', 'Thick'];

export interface DrawingTarget {
  id: string;
  d: Drawing;
  /** On air (as an input or an overlay that is on), lined up in Next, or ready on an overlay that is off. */
  where: 'onAir' | 'next' | 'ready';
  /** The overlay channel it is on, if it is on one. */
  channel: number | null;
}

/** The drawing input this screen's card controls: in Next or on air, or on an overlay. */
export function drawingTarget(show: Show, screen: ScreenId): DrawingTarget | null {
  if (screen === 'monitor') return null;
  const sc = show.screens[screen];
  const kindOf = (id: string | null) => show.sources.find((s) => s.id === id)?.kind;
  for (const [id, where] of [
    [sc.program, 'onAir'],
    [sc.preview, 'next'],
  ] as const) {
    const k = kindOf(id);
    if (id && k?.type === 'drawing') return { id, d: k, where, channel: null };
  }
  for (let ch = 0; ch < show.overlays.length; ch++) {
    const o = show.overlays[ch]!;
    const k = kindOf(o.sourceId);
    if (o.sourceId && k?.type === 'drawing' && (o.screens.length === 0 || o.screens.includes(screen)))
      return { id: o.sourceId, d: k, where: o.on ? 'onAir' : 'ready', channel: ch };
  }
  return null;
}

/**
 * Drawing on screen, live: draw on the picture with the mouse, a pen or a
 * finger. Each line goes on screen when it is finished.
 */
export function DrawingCard({ show, act, screen, client }: { show: Show; act: Act; screen: ScreenId; client: EngineClient }) {
  const target = drawingTarget(show, screen);
  const [color, setColor] = useState<string>(PEN_COLORS[0]);
  const [width, setWidth] = useState<number>(PEN_WIDTHS[1]);
  const [arrow, setArrow] = useState(false);
  const [live, setLive] = useState<Stroke | null>(null);
  const pad = useRef<HTMLDivElement>(null);
  if (!target) return null;
  const { id, d, where, channel } = target;
  const sc = screen === 'monitor' ? 'live' : screen;

  const at = (e: React.PointerEvent): [number, number] => {
    const r = pad.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / Math.max(1, r.width), (e.clientY - r.top) / Math.max(1, r.height)];
  };
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setLive({ color, width, arrow, points: [at(e)] });
  };
  const move = (e: React.PointerEvent) => {
    if (!live) return;
    const p = at(e);
    setLive((s) => (s ? { ...s, points: [...s.points, p] } : s));
  };
  const up = () => {
    if (!live) return;
    act({ type: 'drawStroke', id, stroke: { ...live, points: thin(live.points) } });
    setLive(null);
  };

  return (
    <div className="pk drc" aria-label="Drawing on screen">
      <div className="pk__head">
        <b className={`cd__tag cd__tag--${where === 'next' ? 'next' : where === 'onAir' ? 'onAir' : 'next'}`}>
          {where === 'onAir' ? 'ON AIR' : where === 'next' ? 'NEXT' : 'READY'}
        </b>
        <span className="pk__where">
          Drawing · {d.strokes.length} line{d.strokes.length === 1 ? '' : 's'}
        </span>
        {channel !== null && (
          <button
            type="button"
            className={`btn pk__edit${where === 'onAir' ? '' : ' btn--primary'}`}
            onClick={() => act({ type: 'setOverlayOn', channel, value: where !== 'onAir' })}
          >
            {where === 'onAir' ? 'Take off' : 'Put on screen'}
          </button>
        )}
      </div>
      <div
        ref={pad}
        className="drc__pad"
        role="img"
        aria-label="Draw here: the drawing goes over the picture"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setLive(null)}
      >
        <div className="drc__picture" aria-hidden="true">
          <ProgramView show={show} screen={sc} client={client} />
        </div>
        <DrawingView d={d} extra={live} />
      </div>
      <div className="drc__tools" role="toolbar" aria-label="Pen">
        {PEN_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="drc__color"
            style={{ background: c }}
            aria-label={COLOR_NAMES[c]}
            aria-pressed={color === c}
            onClick={() => setColor(c)}
          />
        ))}
        <span className="drc__gap" />
        {PEN_WIDTHS.map((w, i) => (
          <button key={w} type="button" className="btn btn--small" aria-pressed={width === w} onClick={() => setWidth(w)}>
            {WIDTH_NAMES[i]}
          </button>
        ))}
        <button type="button" className="btn btn--small" aria-pressed={arrow} onClick={() => setArrow(!arrow)} title="End each line with an arrow">
          {arrow ? <MoveUpRight aria-hidden="true" /> : <PenLine aria-hidden="true" />} Arrow
        </button>
      </div>
      <div className="pk__row">
        <button type="button" className="btn" disabled={!d.strokes.length} onClick={() => act({ type: 'drawUndo', id })}>
          <Undo2 aria-hidden="true" /> Undo line
        </button>
        <button type="button" className="btn" disabled={!d.strokes.length} onClick={() => act({ type: 'drawClear', id })}>
          <Eraser aria-hidden="true" /> Clear all
        </button>
      </div>
    </div>
  );
}
