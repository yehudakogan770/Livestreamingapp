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
