import { createContext, useContext } from 'react';
import type { EventInfo } from './types/EventInfo';
import type { Show } from './types/Show';
import type { Source } from './types/Source';
import type { Visuals } from './types/Visuals';

/** Show-wide things any picture in this window may need: the event (logo, emergency plan). */
export interface Stage {
  event: EventInfo;
  /** Turns a file path into something this window can load. */
  mediaUrl: (path: string) => string;
  /** Every input (for pictures drawn inside another, like a camera behind the pesukim). */
  sources?: Source[];
  /** The stage visuals (tempo, scene, effects). */
  visuals?: Visuals;
  /** The data file's values ({Column} in titles). */
  data?: Record<string, string>;
  /** What each screen shows (a countdown fading off air hides its logo). */
  screens?: Show['screens'];
}

export const StageContext = createContext<Stage | null>(null);
export const useStage = () => useContext(StageContext);
