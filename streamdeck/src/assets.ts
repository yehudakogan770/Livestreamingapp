// The pictures the Stream Deck app shows before the plugin is running: each
// action's icon in the action list, each key's first picture, and the
// plugin's own icon. Drawn from the same icons as the live keys; written
// into com.lumora.streamdeck.sdPlugin/imgs by scripts/pack.mjs.

import { KINDS, type Kind } from './actions';
import { ICONS, iconSvg, type IconName } from './icons';
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
};

/** The plugin's icon: Lumora's mark on its dark tile. */
function pluginIcon(size: number): string {
  const s = size / 24;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${size * 0.18}" fill="${COLORS.background}"/>` +
    `<g transform="translate(${size * 0.18} ${size * 0.18}) scale(${s * 0.64})" fill="none" stroke="${COLORS.text}" color="${COLORS.text}" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS.lumora}</g></svg>\n`
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
  return files;
}
