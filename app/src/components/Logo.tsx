import type { ScreenId } from '../engine/types/ScreenId';

// The iris-blades mark. Three blades for the three screens; the lit blade is
// the screen being controlled; the red center is "on air".
const BLADES = [
  'M25.65 3.06 A21 21 0 0 1 42.95 33.04 L29.01 33.23 A10.5 10.5 0 0 0 30.82 16.02 Z',
  'M41.31 35.89 A21 21 0 0 1 6.69 35.89 L13.50 23.73 A10.5 10.5 0 0 0 27.50 33.90 Z',
  'M5.05 33.04 A21 21 0 0 1 22.35 3.06 L29.49 15.05 A10.5 10.5 0 0 0 13.68 22.09 Z',
] as const;

const BLADE_FOR: Record<ScreenId, number> = { live: 0, back: 1, monitor: 2 };

// The mark in its own colors (docs/img/lumora-mark.svg). Lumora Studio's has
// an amber blade and a gray light (editor/app/public/brand/studio-logo.svg).
const COLORS = {
  lumora: { blades: ['#4fb3bf', '#d6d8dc', '#8f949c'], light: '#e0473b' },
  studio: { blades: ['#e0973f', '#d9d9d9', '#8c8c8c'], light: '#d9d9d9' },
} as const;

/** Which app's mark: Lumora's, or Lumora Studio's. */
export type MarkOf = keyof typeof COLORS;

/** The app's mark as it is everywhere else (icons, website): for headers of the app's own windows. */
export function BrandMark({ size = 16, of = 'lumora', className }: { size?: number; of?: MarkOf; className?: string }) {
  const c = COLORS[of];
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" data-mark={of}>
      {BLADES.map((d, i) => (
        <path key={d} d={d} fill={c.blades[i]} />
      ))}
      {of === 'studio' && <circle cx="24" cy="24" r="5.6" fill="#1c1c1c" />}
      <circle cx="24" cy="24" r={of === 'studio' ? 3.2 : 5.6} fill={c.light} />
    </svg>
  );
}

export function LogoMark({ size = 18, lit = 'live' }: { size?: number; lit?: ScreenId }) {
  const active = BLADE_FOR[lit];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" data-lit={lit}>
      {BLADES.map((d, i) => {
        const on = i === active;
        // Blade after the lit one is dimmest, so the mark reads as turning.
        const opacity = on ? 1 : (i - active + 3) % 3 === 1 ? 0.5 : 0.8;
        return <path key={d} d={d} fill={on ? 'var(--accent)' : '#ffffff'} opacity={opacity} data-on={on} />;
      })}
      <circle cx="24" cy="24" r="5.6" fill="var(--on-air)" />
    </svg>
  );
}
