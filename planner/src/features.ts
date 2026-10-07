// The Lumora team's switches for the Planner (People and approvals → Features):
// chat and sharing. The server enforces them too; here the Planner just
// says so instead of offering what would be refused.

import { createContext, useContext } from 'react';

export interface PlannerFeatures {
  /** Planner chat: sending new messages. */
  chat: boolean;
  /** Sharing plans and inviting people. */
  sharing: boolean;
}

export const PlannerFeaturesCtx = createContext<PlannerFeatures>({ chat: true, sharing: true });
export const usePlannerFeatures = (): PlannerFeatures => useContext(PlannerFeaturesCtx);
