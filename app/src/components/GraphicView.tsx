import { useEffect, useState, type CSSProperties } from 'react';
import type { Graphic } from '../engine/types/Graphic';
import type { Element } from '../engine/types/Element';
import { entranceAt, settleMs } from '../engine/graphic';
import { fill } from '../engine/data';
import { useStage } from '../engine/CountdownContext';
import { withAlpha } from '../engine/text';

/** One element, placed in % of the frame (sizes in cqh, like every picture). */
export function elementStyle(e: Element, look: { alpha: number; dx: number; dy: number; scale: number }): CSSProperties {
  return {
    position: 'absolute',
    left: `${e.x}%`,
    top: `${e.y}%`,
    width: `${e.w}%`,
    height: `${e.h}%`,
    opacity: e.opacity * look.alpha,
    transform: `translate(${look.dx}cqw, ${look.dy}cqh) scale(${look.scale})`,
  };
}

/**
 * A designed graphic: transparent except its elements, so it sits over what
 * is behind it. Elements come in when it appears. Mirrored in compositor.ts graphic().
 */
export function GraphicView({
  g,
  url,
  thumb = false,
  onPick,
  picked,
}: {
  g: Graphic;
  url: (p: string) => string;
  thumb?: boolean;
  onPick?: (id: number, e: React.PointerEvent) => void;
  picked?: number | null;
}) {
  const data = useStage()?.data;
  const [start] = useState(() => performance.now());
  const [t, setT] = useState(thumb || onPick ? 1e9 : 0);
  const settle = settleMs(g);
  useEffect(() => {
    if (thumb || onPick) return;
    let raf = requestAnimationFrame(function tick() {
      const now = performance.now() - start;
      setT(now);
      if (now < settle + 50) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [thumb, onPick, start, settle]);
  return (
    <div className="grfx" data-kind="graphic" style={{ position: 'absolute', inset: 0, overflow: 'hidden', containerType: 'size' }}>
      {g.elements.map((e) => {
        const look = entranceAt(e, t);
        const style = elementStyle(e, look);
        const pick = onPick ? { onPointerDown: (ev: React.PointerEvent) => onPick(e.id, ev), 'data-picked': picked === e.id ? '' : undefined } : {};
        if (e.kind === 'box')
          return (
            <div
              key={e.id}
              className="grfx__el"
              {...pick}
              style={{ ...style, background: e.color, borderRadius: `${e.radius}cqh`, boxShadow: e.shadow ? '0 0.6cqh 2cqh rgba(0,0,0,0.5)' : undefined }}
            />
          );
        if (e.kind === 'image')
          return (
            <div key={e.id} className="grfx__el" {...pick} style={style}>
              {e.path && <img src={url(e.path)} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />}
            </div>
          );
        return (
          <div
            key={e.id}
            className="grfx__el"
            {...pick}
            dir="auto"
            style={{
              ...style,
              display: 'flex',
              alignItems: 'center',
              justifyContent: e.align === 'center' ? 'center' : e.align === 'right' ? 'flex-end' : 'flex-start',
              textAlign: e.align,
              color: e.color,
              fontFamily: `"${e.font}", "Segoe UI", system-ui, sans-serif`,
              fontSize: `${e.size}cqh`,
              fontWeight: e.weight,
              fontStyle: e.italic ? 'italic' : undefined,
              lineHeight: 1.2,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              textShadow: e.shadow ? `0 0.3cqh 1.2cqh ${withAlpha('#000000', 0.7)}` : undefined,
            }}
          >
            {fill(e.text, data)}
          </div>
        );
      })}
    </div>
  );
}
