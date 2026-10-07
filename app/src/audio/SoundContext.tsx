import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { EngineClient } from '../engine/client';
import type { Show } from '../engine/types/Show';
import { SoundEngine } from './soundEngine';

const Ctx = createContext<SoundEngine | null>(null);

/** Runs the sound engine for the control window and shares it with the mixer. */
export function SoundProvider({ show, client, children }: { show: Show; client: EngineClient; children: ReactNode }) {
  const [engine, setEngine] = useState<SoundEngine | null>(null);
  useEffect(() => {
    if (typeof AudioContext === 'undefined') return;
    const e = new SoundEngine(client);
    setEngine(e);
    return () => e.dispose();
  }, [client]);
  useEffect(() => engine?.setShow(show), [engine, show]);
  return <Ctx.Provider value={engine}>{children}</Ctx.Provider>;
}

export function useSound(): SoundEngine | null {
  return useContext(Ctx);
}

/** Every meter on the page, drawn together from one animation frame. */
const meters = new Set<(now: number) => void>();
let meterFrame = 0;
let meterDrawn = 0;
function drawMeters(now: number) {
  // The levels change 30 times a second: drawing more often shows nothing new.
  if (now - meterDrawn >= 30) {
    meterDrawn = now;
    for (const draw of meters) draw(now);
  }
  meterFrame = meters.size ? requestAnimationFrame(drawMeters) : 0;
}

/**
 * A level meter that redraws itself 30 times a second without re-rendering
 * React. Green, yellow above −12 dB, red above −3 dB.
 */
export function Meter({ id, vertical = true }: { id: string; vertical?: boolean }) {
  const engine = useSound();
  const bar = useRef<HTMLDivElement>(null);
  const hold = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!engine) return;
    let peakHold = 0;
    let holdAt = 0;
    let shownPos = -1;
    let shownHold = -1;
    const draw = (now: number) => {
      const level = engine.levels.get(id) ?? 0;
      const db = level <= 0.001 ? -60 : Math.max(-60, 20 * Math.log10(level));
      const pos = (db + 60) / 60;
      if (pos >= peakHold || now - holdAt > 1200) {
        peakHold = pos;
        holdAt = now;
      }
      if (bar.current && pos !== shownPos) bar.current.style[vertical ? 'height' : 'width'] = `${pos * 100}%`;
      shownPos = pos;
      if (hold.current && peakHold !== shownHold) {
        hold.current.style[vertical ? 'bottom' : 'left'] = `${peakHold * 100}%`;
        hold.current.style.background = peakHold > 0.95 ? '#ff5a4f' : peakHold > 0.8 ? '#f2c14e' : '#6ee089';
      }
      shownHold = peakHold;
    };
    meters.add(draw);
    if (!meterFrame) meterFrame = requestAnimationFrame(drawMeters);
    return () => {
      meters.delete(draw);
      if (!meters.size && meterFrame) {
        cancelAnimationFrame(meterFrame);
        meterFrame = 0;
      }
    };
  }, [engine, id, vertical]);
  return (
    <div className={`meter${vertical ? '' : ' meter--h'}`} aria-hidden>
      <div ref={bar} className="meter__bar" />
      <div ref={hold} className="meter__hold" />
    </div>
  );
}
