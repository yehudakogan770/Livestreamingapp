// The pictures the Stream Deck app shows before the plugin is running: each
// action's icon in the action list, each key's first picture, and the
// plugin's own icon. Drawn from the same icons as the live keys; written
// into com.lumora.streamdeck.sdPlugin/imgs by scripts/pack.mjs.

import { KINDS, type Kind } from './actions';
import { DIAL_KINDS } from './dials';
import { iconSvg, type IconName } from './icons';
import { COLORS, keyModel, renderSvg } from './keys';

export const ICON_OF: Record<Kind, IconName> = {
  take: 'take',
  cut: 'cut',
  blank: 'blank',
  panic: 'panic',
  input: 'input',
  overlay: 'overlay',
  preset: 'preset',
  replay: 'replay',
  record: 'record',
  golive: 'live',
  countdown: 'countdown',
  nextcue: 'cue',
  screen: 'screen',
  rehearsal: 'rehearsal',
  backup: 'backup',
  slidenext: 'slideNext',
  slideback: 'slideBack',
  slidefirst: 'slideFirst',
  macro: 'macro',
};

/** Lumora's mark in its own colors (docs/img/lumora-mark.svg), on a 48 × 48 grid. */
const MARK =
  '<path d="M25.65 3.06 A21 21 0 0 1 42.95 33.04 L29.01 33.23 A10.5 10.5 0 0 0 30.82 16.02 Z" fill="#4fb3bf"/>' +
  '<path d="M41.31 35.89 A21 21 0 0 1 6.69 35.89 L13.50 23.73 A10.5 10.5 0 0 0 27.50 33.90 Z" fill="#d6d8dc"/>' +
  '<path d="M5.05 33.04 A21 21 0 0 1 22.35 3.06 L29.49 15.05 A10.5 10.5 0 0 0 13.68 22.09 Z" fill="#8f949c"/>' +
  '<circle cx="24" cy="24" r="5.6" fill="#e0473b"/>';

/** The plugin's icon: Lumora's mark on its dark tile, like the app's own icon. */
function pluginIcon(size: number): string {
  const inset = size * 0.16;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${size * 0.18}" fill="${COLORS.background}"/>` +
    `<g transform="translate(${inset} ${inset}) scale(${(size - 2 * inset) / 48})">${MARK}</g></svg>\n`
  );
}

/** Every generated picture, by its path inside the .sdPlugin folder. */
export function assetFiles(): Record<string, string> {
  const files: Record<string, string> = {
    'imgs/plugin/icon.svg': pluginIcon(256),
    'imgs/plugin/category.svg': iconSvg('lumora', 28, '#FFFFFF', 1.6),
  };
  for (const kind of KINDS) {
    files[`imgs/actions/${kind}.svg`] = iconSvg(ICON_OF[kind], 20, '#FFFFFF', 1.6);
    const model = keyModel(kind, {}, { state: null, connection: 'online', deck: 'live', now: 0 });
    files[`imgs/keys/${kind}.svg`] = `${renderSvg(model)}\n`;
  }
  // Stream Deck + dials: their icon in the list, and on the dial.
  for (const kind of DIAL_KINDS) {
    files[`imgs/actions/${kind}.svg`] = iconSvg(kind, 20, '#FFFFFF', 1.6);
    files[`imgs/keys/${kind}.svg`] = iconSvg(kind, 72, '#FFFFFF', 1.4);
  }
  return files;
}
