import { useEffect, useState } from 'react';

/**
 * The current time in ms, re-rendering every animation frame while `active`
 * (transitions, fades) and every `idleMs` otherwise (clocks, video times).
 * Frames are only requested while something is actually moving.
 */
export function useNow(active: boolean, idleMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (active) {
      let id = requestAnimationFrame(function tick() {
        setNow(Date.now());
        id = requestAnimationFrame(tick);
      });
      return () => cancelAnimationFrame(id);
    }
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), idleMs);
    return () => clearInterval(id);
  }, [active, idleMs]);
  return now;
}
