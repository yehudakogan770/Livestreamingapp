// Smart filters: filters kept on a smart object as settings, redone from the
// object's own pixels whenever anything changes (the Layers panel lists them
// under the layer, each with its own eye, blend mode and opacity).

import type { BlendMode } from './blend';

export interface SmartFilter {
  id: string;
  /** A filter id from filters/registry.ts. */
  filter: string;
  params: Record<string, unknown>;
  visible: boolean;
  blend: BlendMode;
  opacity: number;
}
