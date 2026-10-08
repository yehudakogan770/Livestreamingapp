import { useEffect, useLayoutEffect, useReducer, useRef, type CSSProperties } from 'react';
import type { EngineClient } from '../engine/client';
import type { Overlay } from '../engine/types/Overlay';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import { overlayKeyframes, overlayShowing } from '../engine/overlays';
import { SourceView } from './SourceView';
import { TitlerChannel } from '../titler/TitlerView';

const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

/**
 * The overlays on one screen, in channel order (channel 4 on top). Each
 * comes in and goes out with its own animation, run by the browser so it
 * stays smooth. `next`: the Next monitor, which also shows overlays being
 * set up there.
 */
export function OverlaysView({
  show,
  screen,
  client,
  next = false,
  audience = false,
}: {
  show: Show;
  screen: ScreenId;
  client: EngineClient;
  next?: boolean;
  audience?: boolean;
}) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const now = Date.now();
  const list = show.overlays
    .map((o, channel) => ({ o, channel }))
    .filter(({ o }) => o.sourceId !== null && o.screens.includes(screen) && (overlayShowing(o, now) || (next && o.inNext)));
  // Redraw once an overlay has finished going out, so it is removed.
  const endsAt = Math.min(...list.filter(({ o }) => !o.on && !(next && o.inNext)).map(({ o }) => o.changedAt + o.animMs), Infinity);
  useEffect(() => {
    if (!Number.isFinite(endsAt)) return;
    const id = setTimeout(rerender, Math.max(0, endsAt - Date.now()) + 20);
    return () => clearTimeout(id);
  }, [endsAt]);
  if (list.length === 0) return null;
  return (
    <>
      {list.map(({ o, channel }) => {
        const src = show.sources.find((s) => s.id === o.sourceId);
        if (!src) return null;
        // In Next only (not on air): shown still, marked so it reads as "being set up".
        const staged = next && o.inNext && !o.on;
        return (
          <OverlayBox key={channel} o={o} animate={!staged} staged={staged}>
            {/* A Titler graphic plays its own IN and OUT from the channel going on and off. */}
            <TitlerChannel.Provider value={staged ? null : { on: o.on, changedAt: o.changedAt }}>
              <SourceView source={src} client={client} audience={audience} />
            </TitlerChannel.Provider>
          </OverlayBox>
        );
      })}
    </>
  );
}

function OverlayBox({ o, animate, staged, children }: { o: Overlay; animate: boolean; staged: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = animate ? `${o.on}:${o.changedAt}:${o.animIn}:${o.animOut}:${o.animMs}` : null;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!key || !el || !canAnimate || o.animMs <= 0) return;
    const dir = o.on ? 'in' : 'out';
    const a = el.animate(overlayKeyframes(dir === 'in' ? o.animIn : o.animOut, dir), {
      duration: o.animMs,
      fill: 'forwards',
      easing: dir === 'in' ? 'cubic-bezier(0.2, 0.7, 0.3, 1)' : 'cubic-bezier(0.5, 0, 0.8, 0.4)',
    });
    a.currentTime = Math.min(o.animMs, Math.max(0, Date.now() - o.changedAt));
    return () => a.cancel();
    // The key covers everything the animation depends on.
  }, [key]);
  const style: CSSProperties = {
    position: 'absolute',
    left: `${o.frame.x}%`,
    top: `${o.frame.y}%`,
    width: `${o.frame.w}%`,
    height: `${o.frame.h}%`,
    overflow: 'hidden',
    zIndex: 3,
    willChange: 'opacity, transform',
    outline: staged ? '2px dashed #3fbf5a' : undefined,
  };
  return (
    <div style={{ ...style, opacity: o.opacity }} data-overlay>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }}>
        {children}
      </div>
    </div>
  );
}
