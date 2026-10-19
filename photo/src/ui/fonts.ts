// The fonts the Type tool offers: the ones bundled with the app (the same
// families Lumora, Studio and the Titler have) and common system fonts.

export const BUNDLED_FONTS = [
  'Inter Variable',
  'Bebas Neue',
  'Chakra Petch',
  'Frank Ruhl Libre',
  'Great Vibes',
  'Heebo',
  'David Libre',
  'JetBrains Mono Variable',
];

const SYSTEM_FONTS = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS', 'Segoe UI', 'Helvetica'];

function available(f: string): boolean {
  try {
    return typeof document === 'undefined' || !document.fonts || document.fonts.check(`12px "${f}"`);
  } catch {
    return true;
  }
}

export const FONT_FAMILIES: string[] = [...BUNDLED_FONTS, ...SYSTEM_FONTS.filter(available)];
