// Line icons for the keys and the action list: one 24 × 24 grid, a single
// stroke weight, no fills except where a shape is meant to read as solid.
// Drawn with `currentColor`, so each key picks its own color.

export const ICONS = {
  // An arrow going up into a screen.
  take: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 21v-9"/><path d="M8.5 15.5 12 12l3.5 3.5"/>',
  // Hard cut: two screens and a sharp break.
  cut: '<rect x="2.5" y="6" width="8" height="12" rx="1"/><rect x="13.5" y="6" width="8" height="12" rx="1"/><path d="M12 3v18"/>',
  // A screen fading to black.
  blank:
    '<rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 20h8"/><path d="M12 17v3"/><path d="M3 10.5 9.5 4"/><path d="M3 17 16 4"/><path d="M9.5 17 21 5.5"/>',
  // Stop sign with an exclamation mark.
  panic: '<path d="M8.2 2.8h7.6l5.4 5.4v7.6l-5.4 5.4H8.2l-5.4-5.4V8.2z"/><path d="M12 7.5v5.5"/><path d="M12 16.4v.1"/>',
  // A camera.
  input: '<rect x="2.5" y="6.5" width="13" height="11" rx="1.5"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/>',
  // A list of steps with a play arrow: several steps with one key.
  macro: '<path d="M4 6h9"/><path d="M4 11h9"/><path d="M4 16h6"/><path d="m14.5 13.5 6 3.5-6 3.5z"/>',
  // Layers.
  overlay: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 16.5 9 5 9-5"/>',
  // A grid of four.
  preset:
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
  // Going back in time, then playing.
  replay: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 3.5V8h4.5"/><path d="m10.5 9 4.5 3-4.5 3z"/>',
  // A ring around a dot.
  record: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4" fill="currentColor"/>',
  // Broadcast waves.
  live: '<circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6"/><path d="M15.8 8.2a5.4 5.4 0 0 1 0 7.6"/><path d="M5.2 5.2a9.6 9.6 0 0 0 0 13.6"/><path d="M18.8 5.2a9.6 9.6 0 0 1 0 13.6"/>',
  // A stopwatch.
  countdown: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5"/><path d="M9.5 2.5h5"/><path d="M12 2.5V6"/><path d="m18.5 6.5 1.5-1.5"/>',
  // Skip to the next one.
  cue: '<path d="m5 5.5 9 6.5-9 6.5z"/><path d="M18.5 5.5v13"/>',
  // Two screens with an arrow between them.
  screen:
    '<rect x="2.5" y="4" width="8.5" height="7" rx="1"/><rect x="13" y="13" width="8.5" height="7" rx="1"/><path d="M15 5h3.5a1.5 1.5 0 0 1 1.5 1.5V10"/><path d="m18 8 2 2 2-2"/><path d="M9 19H5.5A1.5 1.5 0 0 1 4 17.5V14"/><path d="m2 16 2-2 2 2"/>',
  // A clipboard with a tick: a practice run.
  rehearsal: '<rect x="5" y="4" width="14" height="17" rx="1.5"/><path d="M9 4V2.8h6V4"/><path d="m8.5 13 2.5 2.5 4.5-5"/>',
  // A camera with a second one behind it: a backup lineup.
  backup:
    '<rect x="2.5" y="9" width="11" height="9" rx="1.5"/><path d="m13.5 12 4-2.5v8l-4-2.5"/><path d="M6 6h9.5A1.5 1.5 0 0 1 17 7.5"/><path d="M19.5 7.5 21.5 6v6"/>',
  // A slide with an arrow onward.
  slideNext: '<rect x="2.5" y="5" width="13" height="10" rx="1"/><path d="M18 10h4"/><path d="m20 8 2 2-2 2"/><path d="M6 19h6"/>',
  // A slide with an arrow back.
  slideBack: '<rect x="8.5" y="5" width="13" height="10" rx="1"/><path d="M6 10H2"/><path d="m4 8-2 2 2 2"/><path d="M12 19h6"/>',
  // Back to the first slide: an arrow to a bar.
  slideFirst: '<rect x="8.5" y="5" width="13" height="10" rx="1"/><path d="M2.5 6v8"/><path d="M7 10H4"/><path d="m5.5 8-2 2 2 2"/><path d="M12 19h6"/>',
  // A speaker with a slash: mute.
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5"/><path d="m21 9.5-5 5"/>',
  // A T-bar: a fader track with its handle (a dial on Stream Deck +).
  tbar: '<path d="M12 2.5v19"/><rect x="6.5" y="9" width="11" height="5" rx="1.2"/><path d="M8.5 11.5h7"/>',
  // Three sound faders.
  fader:
    '<path d="M6 3.5v17"/><path d="M12 3.5v17"/><path d="M18 3.5v17"/><rect x="4" y="13" width="4" height="3.2" rx="0.8"/><rect x="10" y="6.5" width="4" height="3.2" rx="0.8"/><rect x="16" y="10" width="4" height="3.2" rx="0.8"/>',
  // A warning triangle (Lumora can't be reached).
  warning: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5"/><path d="M12 17.3v.1"/>',
  // Lumora's mark (docs/img/lumora-mark.svg) solid in one color: three blades and the on-air light.
  lumora:
    '<g transform="scale(0.5)" fill="currentColor" stroke="none">' +
    '<path d="M25.65 3.06 A21 21 0 0 1 42.95 33.04 L29.01 33.23 A10.5 10.5 0 0 0 30.82 16.02 Z"/>' +
    '<path d="M41.31 35.89 A21 21 0 0 1 6.69 35.89 L13.50 23.73 A10.5 10.5 0 0 0 27.50 33.90 Z"/>' +
    '<path d="M5.05 33.04 A21 21 0 0 1 22.35 3.06 L29.49 15.05 A10.5 10.5 0 0 0 13.68 22.09 Z"/>' +
    '<circle cx="24" cy="24" r="5.6"/></g>',
} as const;

export type IconName = keyof typeof ICONS;

/** One icon as a stand-alone SVG (for the action list in the Stream Deck app). */
export function iconSvg(name: IconName, size: number, color = '#FFFFFF', stroke = 1.6): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" ` +
    `stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" color="${color}">${ICONS[name]}</svg>\n`
  );
}
