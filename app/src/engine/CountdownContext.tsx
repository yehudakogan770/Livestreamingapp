import { createContext, useContext } from 'react';
import type { Countdown } from './types/Countdown';
import type { EventInfo } from './types/EventInfo';

/** Show-wide things any picture in this window may need: the countdown and the event (logo, emergency plan). */
export interface Stage {
  countdown: Countdown;
  event: EventInfo;
  /** Turns a file path into something this window can load. */
  mediaUrl: (path: string) => string;
}

export const StageContext = createContext<Stage | null>(null);
export const useStage = () => useContext(StageContext);
export const useCountdown = () => useContext(StageContext)?.countdown ?? null;
