// Lumora Titler's mark: a violet tile with two bars, like a lower third.
// Violet is used only here (the logo); the app itself is neutral.

export const MARK_VIOLET = '#6f5fd0';

export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="60" height="60" rx="14" fill={MARK_VIOLET} />
      <rect x="13" y="30" width="38" height="9" rx="2" fill="#ffffff" />
      <rect x="13" y="42" width="24" height="6" rx="2" fill="#ffffff" fillOpacity="0.72" />
      <rect x="13" y="18" width="4" height="9" rx="1" fill="#ffffff" fillOpacity="0.72" />
    </svg>
  );
}

/** The mark as an SVG file (icons, the web app's favicon). */
export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="14" fill="${MARK_VIOLET}"/><rect x="13" y="30" width="38" height="9" rx="2" fill="#ffffff"/><rect x="13" y="42" width="24" height="6" rx="2" fill="#ffffff" fill-opacity="0.72"/><rect x="13" y="18" width="4" height="9" rx="1" fill="#ffffff" fill-opacity="0.72"/></svg>`;
