import { useEffect, useRef } from 'react';

/** Frames per second the time-of-day timecode counts in. */
const FPS = 30;

const pad = (n: number) => String(n).padStart(2, '0');

/** The time of day as broadcast timecode, HH:MM:SS:FF. */
export function timecode(d: Date): string {
  const ff = Math.floor((d.getMilliseconds() / 1000) * FPS);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}:${pad(ff)}`;
}

// Every timecode on the page shares one timer, and writes its text straight
// into the page (no re-render of the screen around it).
const shown = new Set<HTMLElement>();
let timer: ReturnType<typeof setInterval> | null = null;
const tick = () => {
  const text = timecode(new Date());
  for (const el of shown) el.textContent = text;
};

/** A small time-of-day timecode, as on a multiviewer's label strip. */
export function Timecode({ className = 'tc' }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    shown.add(el);
    el.textContent = timecode(new Date());
    if (!timer) timer = setInterval(tick, 100);
    return () => {
      shown.delete(el);
      if (shown.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return <span ref={ref} className={className} aria-hidden="true" />;
}
