import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Visuals } from '../engine/types/Visuals';
import { makeRenderer } from '../visuals/renderer';
import { logoRect, VisualsPlayer } from '../visuals/player';
import { BANKS, sceneColours, sceneRow } from '../visuals/data';

const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };

/**
 * The stage visuals, drawn live with WebGL on their own beat clock. Thumbnails
 * are a still card (the scene's colors and name) so the input grid never
 * uses up the graphics card's drawing contexts.
 */
export function VisualsView({
  v,
  logoUrl = null,
  thumb = false,
  audience = false,
  onFail,
}: {
  v: Visuals;
  /** The event logo (shown when the visuals' logo is on). */
  logoUrl?: string | null;
  thumb?: boolean;
  audience?: boolean;
  onFail?: () => void;
}) {
  if (thumb) return <VisualsCard v={v} />;
  return <VisualsCanvas v={v} logoUrl={logoUrl} audience={audience} onFail={onFail} />;
}

/** A still card for the scene on now. */
export function VisualsCard({ v }: { v: Visuals }) {
  const row = sceneRow(v.scene.bank, v.scene.scene);
  const [a, b, c] = sceneColours(row, v.settings.palette);
  return (
    <div
      style={{
        ...fill,
        background: `radial-gradient(circle at 30% 35%, ${a}cc, transparent 55%), radial-gradient(circle at 70% 65%, ${b}bb, transparent 60%), ${c}55`,
        backgroundColor: '#05060a',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        color: '#fff',
        fontSize: 11,
        fontWeight: 600,
        textShadow: '0 1px 3px #000',
        paddingBottom: '6%',
      }}
      data-kind="visuals"
    >
      {BANKS[v.scene.bank]?.name} · {row[0]}
    </div>
  );
}

function VisualsCanvas({ v, logoUrl, audience, onFail }: { v: Visuals; logoUrl: string | null; audience: boolean; onFail?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const logo = useRef<HTMLImageElement>(null);
  const latest = useRef(v);
  latest.current = v;
  const [works, setWorks] = useState(true);
  // A new canvas after the graphics card drops the old one (a few tries).
  const [tries, setTries] = useState(0);
  const failed = useRef(onFail);
  failed.current = onFail;
  useEffect(() => {
    // A fresh canvas every time: a canvas whose drawing context was released
    // can never draw again.
    const host = box.current;
    if (!host) return;
    const c = document.createElement('canvas');
    Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    c.dataset.kind = 'visuals';
    host.prepend(c);
    const r = makeRenderer(c);
    if (!r || tries > 3) {
      r?.dispose();
      c.remove();
      setWorks(false);
      failed.current?.();
      return;
    }
    // Fonts for the words arrive after the first frames.
    void document.fonts?.ready.then(() => r.refreshText());
    const player = new VisualsPlayer();
    // Screens the audience sees get every pixel of the screen; the control
    // window's monitors draw at their size on the page (no more), so the
    // graphics card's time goes to the outputs.
    let raf = 0;
    let retry = 0;
    const lost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      retry = window.setTimeout(() => setTries((n) => n + 1), 1000);
    };
    c.addEventListener('webglcontextlost', lost);
    const loop = () => {
      const dpr = audience ? window.devicePixelRatio || 1 : Math.min(window.devicePixelRatio || 1, 1);
      const cur = latest.current;
      r.draw(player.frame(cur, Date.now()), c.clientWidth * dpr, c.clientHeight * dpr);
      const img = logo.current;
      if (img && img.naturalWidth) {
        const b = logoRect(cur.logo, player.beatPulse, c.clientWidth, c.clientHeight, img.naturalWidth / img.naturalHeight);
        img.style.left = `${b.x}px`;
        img.style.top = `${b.y}px`;
        img.style.width = `${b.w}px`;
        img.style.height = `${b.h}px`;
        img.style.opacity = cur.blackout ? '0' : '1';
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(retry);
      c.removeEventListener('webglcontextlost', lost);
      r.dispose();
      c.remove();
    };
  }, [audience, tries]);
  if (!works) return audience ? <div style={{ ...fill, background: '#000' }} /> : <VisualsCard v={v} />;
  return (
    <>
      <div ref={box} style={{ ...fill, background: '#000' }} />
      {logoUrl && v.logo.on && (
        <img
          ref={logo}
          src={logoUrl}
          alt=""
          style={{ position: 'absolute', objectFit: 'contain', transition: 'opacity .4s', pointerEvents: 'none' }}
          data-visuals-logo
        />
      )}
    </>
  );
}
