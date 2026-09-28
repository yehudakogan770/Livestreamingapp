import {
  useLayoutEffect,
  useReducer,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { EngineClient } from "../engine/client";
import type { ScreenId } from "../engine/types/ScreenId";
import type { Show } from "../engine/types/Show";
import type { TransitionKind } from "../engine/types/TransitionKind";
import {
  fadeAmount,
  mixAt,
  transitionProgress,
  BLANK_FADE_MS,
  type Mix,
} from "../engine/timing";
import { useNow } from "../engine/useNow";
import { SafeScreenView, SourceView } from "./SourceView";

interface Layer {
  id: string;
  opacity: number;
  clip?: string;
  shift?: number;
}

/**
 * The layers that make up a screen's program at time `now`: the outgoing and
 * incoming pictures of a running transition, the manual T-bar mix, or just
 * what is on air. Layers are keyed by source id so a video element carries on
 * playing when it moves from "incoming" to "on air".
 */
export function programLayers(
  show: Show,
  screen: ScreenId,
  now: number,
): { layers: Layer[]; black: number } {
  const sc = show.screens[screen];
  const layers: Layer[] = [];
  const pair = (outId: string | null, inId: string | null, m: Mix) => {
    if (outId !== null)
      layers.push({ id: outId, opacity: m.outOpacity, shift: m.outShift });
    if (inId !== null && inId !== outId)
      layers.push({
        id: inId,
        opacity: m.inOpacity,
        clip: m.inClip,
        shift: m.inShift,
      });
    return m.black;
  };
  const p = transitionProgress(sc, now);
  if (p < 1 && sc.transition && sc.previous !== null) {
    return {
      layers,
      black: pair(sc.previous, sc.program, mixAt(sc.transition.kind, p)),
    };
  }
  if (sc.tbar > 0 && sc.preview !== null && sc.preview !== sc.program) {
    const kind: TransitionKind =
      show.transition.kind === "cut" ? "fade" : show.transition.kind;
    return {
      layers,
      black: pair(sc.program, sc.preview, mixAt(kind, sc.tbar)),
    };
  }
  if (sc.program !== null) layers.push({ id: sc.program, opacity: 1 });
  return { layers, black: 0 };
}

/** True while something on this screen is animating and needs every frame. */
export function screenMoving(
  show: Show,
  screen: ScreenId,
  now: number,
): boolean {
  return (
    transitionProgress(show.screens[screen], now) < 1 ||
    fading(show, screen, now)
  );
}

/** A blank or PANIC fade is running. */
function fading(show: Show, screen: ScreenId, now: number): boolean {
  const sc = show.screens[screen];
  return (
    now - sc.blankChangedAt < BLANK_FADE_MS + 50 ||
    now - show.panicChangedAt < BLANK_FADE_MS + 50
  );
}

/** The browser can run animations itself (smooth even when the page is busy). */
const canAnimate =
  typeof Element !== "undefined" &&
  typeof Element.prototype.animate === "function";

/** Samples per transition: the browser draws smoothly between them. */
const STEPS = 30;

/** Keyframes for one side of a transition, sampled from {@link mixAt}. */
export function transitionKeyframes(
  kind: TransitionKind,
  side: "in" | "out" | "black",
): Keyframe[] {
  const frames: Keyframe[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const m = mixAt(kind, i / STEPS);
    const offset = i / STEPS;
    if (side === "black") frames.push({ offset, opacity: m.black });
    else if (side === "in")
      frames.push({
        offset,
        opacity: m.inOpacity,
        clipPath: m.inClip ?? "none",
        transform: `translateX(${m.inShift ?? 0}%)`,
      });
    else
      frames.push({
        offset,
        opacity: m.outOpacity,
        transform: `translateX(${m.outShift ?? 0}%)`,
      });
  }
  return frames;
}

/**
 * Run a screen's transition with the browser's own animation engine: every
 * frame is drawn on time even while the app is busy, so fades and slides
 * are smooth. Re-renders once when it ends.
 */
function useTransitionAnimation(
  box: React.RefObject<HTMLDivElement | null>,
  show: Show,
  screen: ScreenId,
): boolean {
  const sc = show.screens[screen];
  const t = sc.transition;
  const running =
    canAnimate &&
    !!t &&
    sc.previous !== null &&
    transitionProgress(sc, Date.now()) < 1;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const key =
    running && t
      ? `${t.startedAt}:${t.kind}:${t.durationMs}:${sc.previous}:${sc.program}`
      : null;
  useLayoutEffect(() => {
    if (!key || !t || !box.current) return;
    const elapsed = Date.now() - t.startedAt;
    const timing: KeyframeAnimationOptions = {
      duration: t.durationMs,
      fill: "forwards",
      easing: "linear",
    };
    const anims: Animation[] = [];
    const run = (
      el: Element | null | undefined,
      side: "in" | "out" | "black",
    ) => {
      if (!el) return;
      const a = el.animate(transitionKeyframes(t.kind, side), timing);
      a.currentTime = Math.min(elapsed, t.durationMs);
      anims.push(a);
    };
    const root = box.current;
    run(
      root.querySelector(`[data-layer="${CSS.escape(sc.previous ?? "")}"]`),
      "out",
    );
    run(
      root.querySelector(`[data-layer="${CSS.escape(sc.program ?? "")}"]`),
      "in",
    );
    run(root.querySelector("[data-dip]"), "black");
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
  position: "absolute",
  inset: 0,
  overflow: "hidden",
  background: "#000",
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
  const moving = animating
    ? fading(show, screen, Date.now())
    : screenMoving(show, screen, Date.now());
  useNow(moving);
  // The ticker above only asks for redraws; each one is drawn for this very moment.
  const now = Date.now();
  const { layers, black } = programLayers(show, screen, now);
  const sc = show.screens[screen];
  const blank = fadeAmount(sc.blank, sc.blankChangedAt, now);
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
              background: "transparent",
              opacity: l.opacity,
              clipPath: l.clip,
              transform: l.shift ? `translateX(${l.shift}%)` : undefined,
              willChange: animating ? "opacity, transform" : undefined,
            }}
          >
            <SourceView
              source={src}
              client={client}
              reportDuration={reportDuration}
              audience={audience}
            />
          </div>
        );
      })}
      {(black > 0 || animating) && (
        <div style={{ ...box, background: "#000", opacity: black }} data-dip />
      )}
      {blank > 0 && (
        <div
          style={{ ...box, background: "#000", opacity: blank, zIndex: 4 }}
          data-blank
        />
      )}
      {panic > 0 && (
        <div style={{ ...box, opacity: panic, zIndex: 5 }} data-panic>
          <SafeScreenView reason="panic" />
        </div>
      )}
      {children}
    </div>
  );
}

/** What is lined up next on a screen. */
export function PreviewView({
  show,
  screen,
  client,
}: {
  show: Show;
  screen: ScreenId;
  client: EngineClient;
}) {
  const id = show.screens[screen].preview;
  const src = id === null ? undefined : show.sources.find((s) => s.id === id);
  return (
    <div style={box}>
      {src && <SourceView key={src.id} source={src} client={client} />}
    </div>
  );
}
