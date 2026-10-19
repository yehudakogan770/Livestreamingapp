import { useEffect, useRef } from 'react';
import type { Reactions } from '../engine/types/Reactions';
import { drawBadge, drawReactions, floating } from '../engine/reactions';
import { useStage } from '../engine/CountdownContext';
import { joinShown } from '../engine/join';

/**
 * Reactions in the control window: drawn by the same code as the screens
 * (engine/reactions.ts), moving only while some are floating. A tile shows
 * the four reactions, so an input that is see-through when quiet can be told apart.
 */
export function ReactionsView({ r, thumb = false }: { r: Reactions; thumb?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(r);
  latest.current = r;
  const wifi = useStage()?.event.wifi;
  const qr = useRef<{ svg: string; img: HTMLImageElement } | null>(null);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let frame = 0;
    const draw = () => {
      const now = Date.now();
      const cur = latest.current;
      const w = c.width;
      const h = c.height;
      ctx.clearRect(0, 0, w, h);
      if (thumb) {
        [0, 1, 2, 3].forEach((k) => drawBadge(ctx, k, w / 2 + (k - 1.5) * h * 0.2, h / 2, h * 0.08));
      } else {
        const j = cur.showJoin && cur.open && cur.joinQr ? joinShown(cur.joinUrl, cur.joinQr, 'Scan to react', wifi, now) : null;
        if (j && qr.current?.svg !== j.qr) {
          const img = new Image();
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(j.qr)}`;
          qr.current = { svg: j.qr, img };
        }
        drawReactions(ctx, cur, now, w, h, j ? { img: qr.current?.img ?? null, label: j.label } : null);
      }
      frame = !thumb && floating(cur, now) ? requestAnimationFrame(draw) : 0;
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [r, thumb, wifi]);

  return (
    <canvas
      ref={canvas}
      width={thumb ? 320 : 960}
      height={thumb ? 180 : 540}
      data-kind="reactions"
      aria-label="Reactions"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  );
}
