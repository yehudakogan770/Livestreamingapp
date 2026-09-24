import { useEffect, useState } from 'react';
import type { EngineClient, ShowSnapshot } from './client';

export interface ShowState {
  snapshot: ShowSnapshot | null;
  error: string | null;
}

/**
 * The current show, kept up to date. Updates that arrive out of order are
 * ignored by comparing revisions, so the screen never goes backwards.
 */
export function useShow(client: EngineClient): ShowState {
  const [state, setState] = useState<ShowState>({ snapshot: null, error: null });

  useEffect(() => {
    let active = true;
    const accept = (next: ShowSnapshot) => {
      if (!active) return;
      setState((prev) =>
        prev.snapshot && prev.snapshot.revision > next.revision ? prev : { snapshot: next, error: null },
      );
    };
    const unsubscribe = client.subscribe(accept);
    client.getShow().then(accept, (err: unknown) => {
      if (active) setState((prev) => ({ ...prev, error: String(err) }));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);

  return state;
}
