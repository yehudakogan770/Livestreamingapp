import { arrowHead } from '../engine/drawing';
import type { Drawing } from '../engine/types/Drawing';
import type { Stroke } from '../engine/types/Stroke';

const W = 1600;
const H = 900;

/** One stroke as SVG, in a 1600 × 900 view. */
function StrokePath({ s }: { s: Stroke }) {
  const sw = s.width * H;
  if (s.points.length === 1) {
    const [x, y] = s.points[0]!;
    return <circle cx={x * W} cy={y * H} r={sw / 2} fill={s.color} />;
  }
  const d = s.points.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * W).toFixed(1)} ${(y * H).toFixed(1)}`).join(' ');
  const head = s.arrow ? arrowHead(s, W, H) : null;
  return (
    <>
      <path d={d} fill="none" stroke={s.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      {head && <polygon points={head.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill={s.color} />}
    </>
  );
}

/** Lines and arrows drawn over the picture (transparent everywhere else). */
export function DrawingView({ d, extra }: { d: Drawing; extra?: Stroke | null }) {
  return (
    <svg
      className="drawing-view"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      aria-hidden="true"
    >
      {d.strokes.map((s, i) => (
        <StrokePath key={i} s={s} />
      ))}
      {extra && extra.points.length > 0 && <StrokePath s={extra} />}
    </svg>
  );
}
