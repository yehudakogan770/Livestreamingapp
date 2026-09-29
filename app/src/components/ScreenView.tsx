import { useLayoutEffect, useReducer, useRef, type CSSProperties, type ReactNode } from 'react';
import type { EngineClient } from '../engine/client';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import type { TransitionKind } from '../engine/types/TransitionKind';
import { fadeAmount, mixAt, stingerSlot, transitionProgress, BLANK_FADE_MS, type Mix, type Shape } from '../engine/timing';
import { useNow } from '../engine/useNow';
import { SafeScreenView, SourceView } from './SourceView';
import { OverlaysView } from './OverlaysView';

export interface Layer {
  id: string;
  opacity: number;
  clip?: string;
  shape?: Shape;
  shift?: number;
  shiftY?: number;
  scale?: number;
  /** Blur as a fraction of the frame height. */
  blur?: number;
  /** Drawn over the other layer. */
  top?: boolean;
}

/** A layer's movement as a CSS transform. */
export function layerTransform(l: { shift?: number; shiftY?: number; scale?: number }): string | undefined {
  if (!l.shift && !l.shiftY && (l.scale ?? 1) === 1) return undefined;
  return `translate(${l.shift ?? 0}%, ${l.shiftY ?? 0}%) scale(${l.scale ?? 1})`;
}

/**
 * The layers that make up a screen's program at time `now`: the outgoing and
 * incoming pictures of a running transition, the manual T-bar mix, or just
 * what is on air. Layers are keyed by source id so a video element carries on
 * playing when it moves from "incoming" to "on air".
 */
/** A stinger playing over a screen's switch. */
export interface StingerPlay {
  path: string;
  /** When it started (the transition's start). */
  startedAt: number;
}

export function programLayers(show: Show, screen: ScreenId, now: number): { layers: Layer[]; black: number; white: number; stinger?: StingerPlay } {
  const sc = show.screens[screen];
  const layers: Layer[] = [];
  let white = 0;
  const pair = (outId: string | null, inId: string | null, m: Mix) => {
    if (outId !== null)
      layers.push({ id: outId, opacity: m.outOpacity, shift: m.outShift, shiftY: m.outShiftY, scale: m.outScale, blur: m.outBlur, top: m.outOnTop });
    if (inId !== null && inId !== outId)
      layers.push({
        id: inId,
        opacity: m.inOpacity,
        clip: m.inClip,
        shape: m.inShape,
        shift: m.inShift,
        shiftY: m.inShiftY,
        scale: m.inScale,
        blur: m.inBlur,
      });
    white = m.white ?? 0;
    return m.black;
  };
  const p = transitionProgress(sc, now);
  const slot = sc.transition ? stingerSlot(sc.transition.kind) : null;
  const st = slot === null ? undefined : show.settings.stingers?.[slot];
  if (p < 1 && sc.transition && st?.path) {
    // Under the stinger the pictures simply change at its cut point.
    const cut = now - sc.transition.startedAt >= st.cutMs;
    if (!cut && sc.previous !== null) layers.push({ id: sc.previous, opacity: 1 });
    else if (sc.program !== null) layers.push({ id: sc.program, opacity: 1 });
    return { layers, black: 0, white: 0, stinger: { path: st.path, startedAt: sc.transition.startedAt } };
  }
  if (p < 1 && sc.transition && sc.previous !== null) {
    const black = pair(sc.previous, sc.program, mixAt(sc.transition.kind, p));
    return { layers, black, white };
  }
  if (sc.tbar > 0 && sc.preview !== null && sc.preview !== sc.program) {
    const kind: TransitionKind = show.transition.kind === 'cut' || stingerSlot(show.transition.kind) !== null ? 'fade' : show.transition.kind;
    const black = pair(sc.program, sc.preview, mixAt(kind, sc.tbar));
    return { layers, black, white };
  }
  if (sc.program !== null) layers.push({ id: sc.program, opacity: 1 });
  return { layers, black: 0, white: 0 };
}

/** True while something on this screen is animating and needs every frame. */
export function screenMoving(show: Show, screen: ScreenId, now: number): boolean {
  return transitionProgress(show.screens[screen], now) < 1 || fading(show, screen, now);
}

/** A blank or PANIC fade is running. */
function fading(show: Show, screen: ScreenId, now: number): boolean {
  const sc = show.screens[screen];
  return now - sc.blankChangedAt < (sc.blankFadeMs || BLANK_FADE_MS) + 50 || now - show.panicChangedAt < BLANK_FADE_MS + 50;
}

/** The browser can run animations itself (smooth even when the page is busy). */
const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

/** Samples per transition: the browser draws smoothly between them. */
const STEPS = 30;

/** Keyframes for one side of a transition, sampled from {@link mixAt}. */
export function transitionKeyframes(kind: TransitionKind, side: 'in' | 'out' | 'black' | 'white', height = 1080): Keyframe[] {
  const frames: Keyframe[] = [];
  const move = (x = 0, y = 0, s = 1) => `translate(${x}%, ${y}%) scale(${s})`;
  const blur = (b = 0) => `blur(${(b * height).toFixed(2)}px)`;
  for (let i = 0; i <= STEPS; i++) {
    const m = mixAt(kind, i / STEPS);
    const offset = i / STEPS;
    if (side === 'black') frames.push({ offset, opacity: m.black });
    else if (side === 'white') frames.push({ offset, opacity: m.white ?? 0 });
    else if (side === 'in')
      frames.push({
        offset,
        opacity: m.inOpacity,
        clipPath: m.inClip ?? 'none',
        transform: move(m.inShift, m.inShiftY, m.inScale),
        filter: blur(m.inBlur),
      });
    else
      frames.push({
        offset,
        opacity: m.outOpacity,
        transform: move(m.outShift, m.outShiftY, m.outScale),
        filter: blur(m.outBlur),
      });
  }
  return frames;
}

/**
 * Run a screen's transition with the browser's own animation engine: every
 * frame is drawn on time even while the app is busy, so fades and slides
 * are smooth. Re-renders once when it ends.
 */
function useTransitionAnimation(box: React.RefObject<HTMLDivElement | null>, show: Show, screen: ScreenId): boolean {
  const sc = show.screens[screen];
  const t = sc.transition;
  // Stingers cut under their video, so React draws them.
  const running = canAnimate && !!t && stingerSlot(t.kind) === null && sc.previous !== null && transitionProgress(sc, Date.now()) < 1;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const key = running && t ? `${t.startedAt}:${t.kind}:${t.durationMs}:${sc.previous}:${sc.program}` : null;
  useLayoutEffect(() => {
    if (!key || !t || !box.current) return;
    const elapsed = Date.now() - t.startedAt;
    const timing: KeyframeAnimationOptions = {
      duration: t.durationMs,
      fill: 'forwards',
      easing: 'linear',
    };
    const anims: Animation[] = [];
    const height = box.current.clientHeight || 1080;
    const run = (el: Element | null | undefined, side: 'in' | 'out' | 'black' | 'white') => {
      if (!el) return;
      const a = el.animate(transitionKeyframes(t.kind, side, height), timing);
      a.currentTime = Math.min(elapsed, t.durationMs);
      anims.push(a);
    };
    const root = box.current;
    run(root.querySelector(`[data-layer="${CSS.escape(sc.previous ?? '')}"]`), 'out');
    run(root.querySelector(`[data-layer="${CSS.escape(sc.program ?? '')}"]`), 'in');
    run(root.querySelector('[data-dip]'), 'black');
    run(root.querySelector('[data-flash]'), 'white');
    // When it ends, draw the finished state (the outgoing picture goes away).
    const done = setTimeout(rerender, Math.max(0, t.durationMs - elapsed) + 20);
    return () => {
      clearTimeout(done);
      anims.forEach((a) => a.cancel());
    };
    // The key covers everything the animation depends on.
  }, [key]);
  return running;
}

const box: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  background: '#000',
};

/** What one screen shows on air (program), with transitions, blank and panic. */
export function ProgramView({
  show,
  screen,
  client,
  reportDuration = false,
  audience = false,
  children,
}: {
  show: Show;
  screen: ScreenId;
  client: EngineClient;
  reportDuration?: boolean;
  /** An audience screen: failed sources show black, never an error. */
  audience?: boolean;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const animating = useTransitionAnimation(ref, show, screen);
  // While the browser runs the transition, React only redraws for fades.
  const moving = animating ? fading(show, screen, Date.now()) : screenMoving(show, screen, Date.now());
  useNow(moving);
  // The ticker above only asks for redraws; each one is drawn for this very moment.
  const now = Date.now();
  const { layers, black, white, stinger } = programLayers(show, screen, now);
  const sc = show.screens[screen];
  const blank = fadeAmount(sc.blank, sc.blankChangedAt, now, sc.blankFadeMs);
  // PANIC shows black or the event logo, as chosen in the event setup.
  const panic = fadeAmount(show.panic, show.panicChangedAt, now);
  return (
    <div ref={ref} style={box} data-screen={screen}>
      {layers.map((l) => {
        const src = show.sources.find((s) => s.id === l.id);
        if (!src) return null;
        return (
          <div
            key={l.id}
            data-layer={l.id}
            style={{
              ...box,
              background: 'transparent',
              opacity: l.opacity,
              clipPath: l.clip,
              transform: layerTransform(l),
              filter: l.blur ? `blur(${(l.blur * (ref.current?.clientHeight ?? 1080)).toFixed(2)}px)` : undefined,
              zIndex: l.top ? 1 : undefined,
              willChange: animating ? 'opacity, transform' : undefined,
            }}
          >
            <SourceView source={src} client={client} reportDuration={reportDuration} audience={audience} />
          </div>
        );
      })}
      <OverlaysView show={show} screen={screen} client={client} audience={audience} />
      {stinger && <StingerVideo key={stinger.startedAt} play={stinger} client={client} />}
      {(black > 0 || animating) && <div style={{ ...box, background: '#000', opacity: black, zIndex: 2 }} data-dip />}
      {(white > 0 || animating) && <div style={{ ...box, background: '#fff', opacity: white, zIndex: 2 }} data-flash />}
      {blank > 0 && <div style={{ ...box, background: '#000', opacity: blank, zIndex: 4 }} data-blank />}
      {panic > 0 && (
        <div style={{ ...box, opacity: panic, zIndex: 5 }} data-panic>
          <SafeScreenView reason="panic" />
        </div>
      )}
      {children}
    </div>
  );
}

/** The stinger video, from where it should be now. */
function StingerVideo({ play, client }: { play: StingerPlay; client: EngineClient }) {
  const ref = useRef<HTMLVideoElement>(null);
  useLayoutEffect(() => {
    const v = ref.current;
    if (!v) return;
    const start = () => {
      v.currentTime = Math.max(0, (Date.now() - play.startedAt) / 1000);
      void v.play().catch(() => {});
    };
    if (v.readyState >= 1) start();
    else v.addEventListener('loadedmetadata', start, { once: true });
  }, [play.startedAt]);
  return (
    <video
      ref={ref}
      src={client.mediaUrl(play.path)}
      muted
      playsInline
      preload="auto"
      crossOrigin="anonymous"
      style={{ ...box, background: 'transparent', width: '100%', height: '100%', objectFit: 'cover', zIndex: 3, pointerEvents: 'none' }}
      data-stinger
    />
  );
}

/** What is lined up next on a screen. */
export function PreviewView({ show, screen, client }: { show: Show; screen: ScreenId; client: EngineClient }) {
  const id = show.screens[screen].preview;
  const src = id === null ? undefined : show.sources.find((s) => s.id === id);
  return (
    <div style={box}>
      {src && <SourceView key={src.id} source={src} client={client} />}
      <OverlaysView show={show} screen={screen} client={client} next />
    </div>
  );
}
