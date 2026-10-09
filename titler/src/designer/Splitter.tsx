// A drag handle on a panel's edge: drag to resize the panel (choosing the
// workspace again puts its sizes back). With the keyboard: arrows, 16 px.

export function Splitter({
  axis,
  edge,
  value,
  onChange,
  label,
}: {
  axis: 'x' | 'y';
  /** The panel's edge it sits on (dragging away from the panel makes it bigger). */
  edge: 'left' | 'right' | 'top';
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const sign = edge === 'right' ? 1 : -1;
  return (
    <div
      className={`tt-splitter tt-splitter-${edge}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={(e) => {
        const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
        const fwd = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (e.key !== back && e.key !== fwd) return;
        e.preventDefault();
        onChange(value + (e.key === fwd ? 16 : -16) * sign);
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        const start = axis === 'x' ? e.clientX : e.clientY;
        const from = value;
        const move = (ev: PointerEvent) => onChange(from + ((axis === 'x' ? ev.clientX : ev.clientY) - start) * sign);
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    />
  );
}
