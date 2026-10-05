import { svgMatrix } from '../model/color';
import type { Angle } from '../model/project';

/** The color settings of each camera as SVG filters the viewer draws with. */
export function LookFilters({ angles }: { angles: Angle[] }) {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        {angles.map((a) => (
          <filter key={a.id} id={`look-${a.id}`} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={svgMatrix(a.look)} />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
