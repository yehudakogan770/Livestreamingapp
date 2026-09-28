import type { CSSProperties, ReactNode } from 'react';
import type { EngineClient } from '../engine/client';
import type { ScreenId } from '../engine/types/ScreenId';
import type { Show } from '../engine/types/Show';
import type { TransitionKind } from '../engine/types/TransitionKind';
import { fadeAmount, mixAt, transitionProgress, BLANK_FADE_MS, type Mix } from '../engine/timing';
import { useNow } from '../engine/useNow';
import { SourceView } from './SourceView';
import { CountdownOverlay } from './CountdownOverlay';

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
export function programLayers(show: Show, screen: ScreenId, now: number): { layers: Layer[]; black: number } {
  const sc = show.screens[screen];
  const layers: Layer[] = [];
  const pair = (outId: string | null, inId: string | null, m: Mix) => {
    if (outId !== null) layers.push({ id: outId, opacity: m.outOpacity, shift: m.outShift });
    if (inId !== null && inId !== outId) layers.push({ id: inId, opacity: m.inOpacity, clip: m.inClip, shift: m.inShift });
    return m.black;
  };
  const p = transitionProgress(sc, now);
  if (p < 1 && sc.transition && sc.previous !== null) {
    return { layers, black: pair(sc.previous, sc.program, mixAt(sc.transition.kind, p)) };
  }
  if (sc.tbar > 0 && sc.preview !== null && sc.preview !== sc.program) {
    const kind: TransitionKind = show.transition.kind === 'cut' ? 'fade' : show.transition.kind;
    return { layers, black: pair(sc.program, sc.preview, mixAt(kind, sc.tbar)) };
  }
  if (sc.program !== null) layers.push({ id: sc.program, opacity: 1 });
  return { layers, black: 0 };
}

/** True while something on this screen is animating and needs every frame. */
export function screenMoving(show: Show, screen: ScreenId, now: number): boolean {
  const sc = show.screens[screen];
  return transitionProgress(sc, now) < 1 || now - sc.blankChangedAt < BLANK_FADE_MS + 50 || now - show.panicChangedAt < BLANK_FADE_MS + 50;
}

const box: CSSProperties = { position: 'absolute', inset: 0, overflow: 'hidden', background: '#000' };

/** What one screen shows on air (program), with transitions, blank and panic. */
export function ProgramView({
  show,
  screen,
  client,
  audible = false,
  reportDuration = false,
  audience = false,
  children,
}: {
  show: Show;
  screen: ScreenId;
  client: EngineClient;
  audible?: boolean;
  reportDuration?: boolean;
  /** An audience screen: failed sources show black, never an error. */
  audience?: boolean;
  children?: ReactNode;
}) {
  const now = useNow(screenMoving(show, screen, Date.now()));
  const { layers, black } = programLayers(show, screen, now);
  const sc = show.screens[screen];
  const blank = Math.max(fadeAmount(sc.blank, sc.blankChangedAt, now), fadeAmount(show.panic, show.panicChangedAt, now));
  return (
    <div style={box} data-screen={screen}>
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
              transform: l.shift ? `translateX(${l.shift}%)` : undefined,
            }}
          >
            <SourceView
              source={src}
              client={client}
              audible={audible && l.opacity > 0}
              master={show.masterVolume * (1 - blank)}
              reportDuration={reportDuration}
              audience={audience}
            />
          </div>
        );
      })}
      {black > 0 && <div style={{ ...box, background: '#000', opacity: black }} />}
      {screen !== 'monitor' && <CountdownOverlay countdown={show.countdown} screen={screen} />}
      {blank > 0 && <div style={{ ...box, background: '#000', opacity: blank, zIndex: 4 }} data-blank />}
      {children}
    </div>
  );
}

/** What is lined up next on a screen. */
export function PreviewView({ show, screen, client }: { show: Show; screen: ScreenId; client: EngineClient }) {
  const id = show.screens[screen].preview;
  const src = id === null ? undefined : show.sources.find((s) => s.id === id);
  return <div style={box}>{src && <SourceView key={src.id} source={src} client={client} />}</div>;
}
