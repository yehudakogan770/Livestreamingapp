// Which Smart dialog is open, in a module of its own so other windows (Export)
// can open one without loading the Smart tools.
import { useSyncExternalStore } from 'react';
import type { Aspect } from './reframe';

export type SmartTool = 'multicam' | 'silence' | 'reframe' | 'highlights';

let open: SmartTool | null = null;
/** The shape Auto reframe starts on (Export asks for the shape of its preset). */
let aspect: Aspect = '9:16';
const listeners = new Set<() => void>();

export function openSmart(t: SmartTool | null, shape?: Aspect): void {
  open = t;
  if (shape) aspect = shape;
  for (const f of listeners) f();
}

export const reframeAspect = (): Aspect => aspect;

export const useOpen = () =>
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => open,
  );
