// Fonts added for the event (font files), loaded in every window so titles,
// the screens and the recording all draw with them.

import { useEffect } from 'react';
import type { CustomFont } from './types/CustomFont';
import type { EngineClient } from './client';

const loaded = new Map<string, FontFace>();

/** Load the event's font files into this window (once each). */
export function useEventFonts(fonts: CustomFont[] | undefined, client: EngineClient): void {
  const key = JSON.stringify(fonts ?? []);
  useEffect(() => {
    if (typeof FontFace === 'undefined') return;
    for (const f of fonts ?? []) {
      const id = `${f.name}|${f.path}`;
      if (loaded.has(id)) continue;
      // Read the file's bytes (whatever type the file server says it is).
      void fetch(client.mediaUrl(f.path))
        .then((r) => r.arrayBuffer())
        .then((buf) => new FontFace(f.name, buf).load())
        .then((face) => {
          document.fonts.add(face);
          loaded.set(id, face);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, client]);
}

/** A font's name from its file name ("Assistant-Bold.ttf" → "Assistant Bold"). */
export const fontNameFrom = (file: string) =>
  file
    .replace(/^.*[\\/]/, '')
    .replace(/#.*$/, '')
    .replace(/\.(ttf|otf|woff2?)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .slice(0, 60);

// ----- the built-in fonts (app/public/fonts, made by scripts/fetch_fonts.py) -----

export type FontCategory = 'Sans Serif' | 'Serif' | 'Display' | 'Handwriting' | 'Monospace' | 'System' | 'Added';
export interface FontInfo {
  family: string;
  category: FontCategory;
  hebrew: boolean;
}

/** Fonts on every Windows computer (and those Lumora had before). */
export const SYSTEM_FONTS: FontInfo[] = [
  ['Segoe UI', false],
  ['Arial', false],
  ['Georgia', false],
  ['Impact', false],
  ['Consolas', false],
  ['Times New Roman', true],
  ['Verdana', false],
  ['Tahoma', true],
  ['Trebuchet MS', false],
  ['Calibri', false],
  ['Cambria', false],
  ['David', true],
  ['Miriam', true],
  ['Narkisim', true],
  ['Bebas Neue', false],
  ['Great Vibes', false],
  ['Chakra Petch', false],
].map(([family, hebrew]) => ({ family: family as string, category: 'System' as const, hebrew: hebrew as boolean }));

let catalogue: Promise<FontInfo[]> | null = null;

/** Every built-in font (loaded once). */
export function builtInFonts(): Promise<FontInfo[]> {
  const base = typeof location !== 'undefined' && location.protocol.startsWith('http') ? '' : '.';
  catalogue ??= fetch(`${base}/fonts/fonts.json`)
    .then((r) => r.json() as Promise<FontInfo[]>)
    .catch(() => []);
  return catalogue;
}

const asked = new Set<string>();

/**
 * Make sure the font in a canvas font string is loaded (fonts load only when
 * used; a canvas does not ask by itself). The first frame may draw with the
 * fallback; the next ones have it.
 */
export function loadFontFor(font: string): void {
  if (asked.has(font) || typeof document === 'undefined' || !document.fonts) return;
  asked.add(font);
  if (!document.fonts.check(font, 'Aא')) void document.fonts.load(font, 'Aaא').catch(() => {});
}
