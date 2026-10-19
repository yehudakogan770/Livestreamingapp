// Lumora Photo's mark: a blue tile with a sun over two hills, drawn like the
// family's other marks (a rounded tile with flat white shapes). Blue is used
// only here; the app itself is neutral.

export const MARK_BLUE = '#3b72d9';

export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="60" height="60" rx="14" fill={MARK_BLUE} />
      <circle cx="42" cy="21" r="6" fill="#ffffff" />
      <path d="M24 48 L40 30 L55 48 Z" fill="#ffffff" fillOpacity="0.72" />
      <path d="M9 48 L24 27 L39 48 Z" fill="#ffffff" />
    </svg>
  );
}

/** The mark as an SVG file (icons, the web app's favicon). */
export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="14" fill="${MARK_BLUE}"/><circle cx="42" cy="21" r="6" fill="#ffffff"/><path d="M24 48 L40 30 L55 48 Z" fill="#ffffff" fill-opacity="0.72"/><path d="M9 48 L24 27 L39 48 Z" fill="#ffffff"/></svg>`;
