// A Titler graphic in a screen window, a tile or a preview: a canvas drawn
// by the Titler renderer, every frame while it animates (or a ticker moves).

import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import { TitlerPainter, type ChannelState } from './drawTitler';
import { projectOf, ticks } from './titlerSource';

/** The overlay channel a graphic is shown in (its IN when it comes on, its OUT when it goes off). */
export const TitlerChannel = createContext<ChannelState | null>(null);

const painters = new Map<string, TitlerPainter>();
function painterFor(urlFor: (p: string) => string, key: string): TitlerPainter {
  let p = painters.get(key);
  if (!p) {
    p = new TitlerPainter(urlFor);
    painters.set(key, p);
  }
  return p;
}

export function TitlerView({ source, show, urlFor, thumb = false }: { source: Source; show: Show | null; urlFor: (p: string) => string; thumb?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const channel = useContext(TitlerChannel);
  const since = useMemo(() => Date.now(), []);
  const painter = painterFor(urlFor, 'screen');
  const k = source.kind.type === 'titler' ? source.kind : null;
  const project = k ? projectOf(k) : null;
  const moving = !!project && (ticks(project) || project.compositions.some((c) => c.layers.some(function scroll(l): boolean {
    return (l.type === 'text' && !!l.scroll) || (l.type === 'group' && l.children.some(scroll));
  })));

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !k || !project) return;
    let raf = 0;
    let alive = true;
    const draw = () => {
      if (!alive) return;
      const box = cv.parentElement?.getBoundingClientRect();
      const dpr = thumb ? 1 : Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
      const w = Math.max(1, Math.round((box?.width || cv.clientWidth || 320) * dpr));
      const h = Math.max(1, Math.round((box?.height || cv.clientHeight || 180) * dpr));
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const now = Date.now();
      // A tile shows the graphic as it holds (not its IN).
      const animating = painter.paint(ctx, source, k, show, thumb ? now : now, w, h, thumb ? null : channel, thumb ? now - 60_000 : since);
      if ((animating || moving) && !thumb) raf = requestAnimationFrame(draw);
    };
    draw();
    const un = painter.env.onReady(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      un();
    };
  }, [source, k, project, show, channel, since, painter, thumb, moving]);

  if (!k) return null;
  return <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-label={source.name} role="img" />;
}
