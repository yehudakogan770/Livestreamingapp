import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import './Fader.css';

/** Fader position for a dB value, on the mixer's curve (gain = position²). */
const posForDb = (db: number) => Math.pow(10, db / 40);
const MARKS = [0, -10, -20, -30, -40];

/**
 * A mixing-desk fader: up is louder. Drag the handle (it moves with your hand,
 * not to where you clicked it), click the track to jump, double-click for 0 dB,
 * arrow keys for fine steps. Drawn by hand so it looks and works the same in
 * every window and on every computer.
 */
export function Fader({ value, label, onChange }: { value: number; label: string; onChange: (v: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; v: number } | null>(null);
  const [local, setLocal] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const send = (v: number) => {
    const c = Math.min(1, Math.max(0, v));
    setLocal(c);
    pending.current = c;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pending.current !== null) onChange(pending.current);
    });
  };
  const at = (clientY: number) => {
    const r = track.current!.getBoundingClientRect();
    return 1 - (clientY - r.top) / r.height;
  };
  const shown = local ?? value;

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const onHandle = (e.target as HTMLElement).classList.contains('fader__handle');
    const start = onHandle ? shown : at(e.clientY);
    if (!onHandle) send(start);
    drag.current = { y: e.clientY, v: start };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const r = track.current?.getBoundingClientRect();
    if (!d || !r || r.height === 0) return;
    // Shift = fine control.
    const scale = e.shiftKey ? 0.2 : 1;
    send(d.v - ((e.clientY - d.y) / r.height) * scale);
  };
  const onUp = () => {
    drag.current = null;
    setLocal(null);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowUp: 0.01, ArrowDown: -0.01, PageUp: 0.1, PageDown: -0.1 }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      onChange(Math.min(1, Math.max(0, value + step)));
    } else if (e.key === 'Home' || e.key === '0') {
      e.preventDefault();
      onChange(1);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(0);
    }
  };

  return (
    <div
      className={`fader${drag.current ? ' is-dragging' : ''}`}
      role="slider"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      tabIndex={0}
      title="Drag · double-click for 0 dB · Shift for fine"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => {
        // Back to 0 dB, and drop the jump the double-click's own clicks queued.
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        pending.current = null;
        drag.current = null;
        setLocal(null);
        onChange(1);
      }}
      onKeyDown={onKey}
    >
      <div className="fader__marks" aria-hidden>
        {MARKS.map((db) => (
          <span key={db} style={{ bottom: `${posForDb(db) * 100}%` }}>
            {db === 0 ? '0' : db}
          </span>
        ))}
      </div>
      <div ref={track} className="fader__track">
        <div className="fader__fill" style={{ height: `${shown * 100}%` }} />
        <div className="fader__handle" style={{ bottom: `${shown * 100}%` }} />
      </div>
    </div>
  );
}
