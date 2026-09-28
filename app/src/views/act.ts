import type { Action } from '../engine/types/Action';

/** Send an action to the engine; refusals are shown to the operator, never thrown. */
export type Act = (action: Action) => void;
