// Icons for the adjustment types (lucide where one fits, a few drawn here).

export { Sun, ChartColumn as BarChart3, Spline, SquarePlus as PlusSquare, Triangle, Palette, Scale, Contrast, Funnel as Filter, Blend, Table2, SquareSlash, Layers2, Rainbow, Crosshair } from 'lucide-react';

/** Threshold: a square half black, half white. */
export function SquareHalf({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 3v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" />
    </svg>
  );
}
