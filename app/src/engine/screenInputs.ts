// Each screen has its own inputs: what is added while controlling Live is in
// Live's list, what is added for Back is in Back's. An input can be in both.

import type { ScreenId } from './types/ScreenId';
import type { Show } from './types/Show';
import type { Source } from './types/Source';

/** In this screen's input list (inputs from before lists were separate are in every list). */
export const inList = (src: Source, screen: ScreenId): boolean => !src.screens?.length || src.screens.includes(screen);

/** This screen's inputs, in order. */
export const screenInputs = (show: Show, screen: ScreenId): Source[] => show.sources.filter((s) => inList(s, screen));

/** The screens an input can be listed on (the stage monitor shows text, not inputs). */
export const LIST_SCREENS: { id: ScreenId; name: string }[] = [
  { id: 'live', name: 'Live' },
  { id: 'back', name: 'Back' },
];
