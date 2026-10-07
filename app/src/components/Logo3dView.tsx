import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Logo3d } from '../engine/types/Logo3d';
import { Logo3dRenderer, loadLogo, placeholderLogo, type PreparedLogo } from '../logo3d/renderer';
import { makeRenderer } from '../visuals/renderer';
import { VisualsPlayer } from '../visuals/player';
import { loopVisuals } from '../logo3d/background';

const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };

/**
 * A 3D logo, turning live. `url` is the logo picture (null: a stand-in).
 * The background (color or a stage visuals loop) is drawn behind; when
 * see-through, whatever is behind this input shows.
 */
export function Logo3dView({
  logo,
  url,
  thumb = false,
  audience = false,
  checker = false,
  onFail,
}: {
  logo: Logo3d;
  url: string | null;
  thumb?: boolean;
  audience?: boolean;
  /** Show a checkerboard where it is see-through (the maker's preview). */
  checker?: boolean;
  onFail?: (why: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(logo);
  latest.current = logo;
  const failed = useRef(onFail);
  failed.current = onFail;
  const [prepared, setPrepared] = useState<PreparedLogo | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!url) {
      setPrepared(placeholderLogo());
      return;
    }
    loadLogo(url).then(
      (p) => alive && setPrepared(p),
      (e: unknown) => {
        if (!alive) return;
        setPrepared(placeholderLogo());
        failed.current?.(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [url]);

  useEffect(() => {
    const host = box.current;
    if (!host || !prepared) return;
    // Fresh canvases each time (a released drawing context never draws again).
    const bg = document.createElement('canvas');
    const fg = document.createElement('canvas');
    for (const c of [bg, fg]) {
      Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
      host.appendChild(c);
    }
    const r = Logo3dRenderer.create(fg);
    if (!r) {
      bg.remove();
      fg.remove();
      setBroken(true);
      failed.current?.('This computer can’t draw 3D (WebGL is off).');
      return;
    }
    r.setLogo(prepared);
    let loop: { draw: ReturnType<typeof makeRenderer>; player: VisualsPlayer } | null = null;
    let raf = 0;
    const frame = () => {
      const l = latest.current;
      const dpr = audience ? Math.min(window.devicePixelRatio || 1, 1.5) : Math.min(window.devicePixelRatio || 1, thumb ? 0.5 : 1);
      const w = fg.clientWidth * dpr;
      const h = fg.clientHeight * dpr;
      const now = Date.now();
      if (l.background === 'loop') {
        if (!loop) loop = { draw: makeRenderer(bg), player: new VisualsPlayer() };
        bg.style.display = 'block';
        loop.draw?.draw(loop.player.frame(loopVisuals(l.bgScene), now), w * 0.6, h * 0.6);
      } else bg.style.display = 'none';
      r.draw(l, now, w, h);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      r.dispose();
      loop?.draw?.dispose();
      bg.remove();
      fg.remove();
    };
  }, [prepared, audience, thumb]);

  const background =
    logo.background === 'colour'
      ? logo.bgColor
      : logo.background === 'transparent' && checker
        ? 'repeating-conic-gradient(#3e3e3e 0 25%, #2d2d2d 0 50%) 0 0 / 24px 24px'
        : 'transparent';
  if (broken) return <div style={{ ...fill, background: audience ? 'transparent' : '#121212' }} />;
  return <div ref={box} style={{ ...fill, background }} data-kind="logo3d" />;
}
