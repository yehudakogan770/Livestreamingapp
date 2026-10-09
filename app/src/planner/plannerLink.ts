// Lumora → Lumora Planner: while Lumora runs cues loaded from a plan, the
// plan's show state follows (the cue on now), so the crew's phones, the stage
// timer and the prompter in the Planner move with the show. Turned on per plan
// when loading it (Run of show → Load from Planner…); it needs the Planner's
// show-day update on the account server and the owner's or an editor's
// account. Nothing here changes what Lumora does.

import { useEffect, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

const KEY = 'lumora.planner.link';

export interface Link {
  planId: string;
  planName: string;
}

export function readLink(): Link | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Link> | null;
    return v && typeof v.planId === 'string' && /^[0-9a-f-]{36}$/i.test(v.planId) ? { planId: v.planId, planName: String(v.planName ?? '') } : null;
  } catch {
    return null;
  }
}

export function writeLink(link: Link | null): void {
  try {
    if (link) localStorage.setItem(KEY, JSON.stringify(link));
    else localStorage.removeItem(KEY);
  } catch {
    // Not kept: the Planner simply does not follow.
  }
}

/** The Planner cue a Lumora cue came from ("planner-<uuid>", maybe with a suffix when loaded twice), or null. */
export function plannerCueId(lumoraCueId: string | undefined | null): string | null {
  const m = /^planner-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(lumoraCueId ?? '');
  return m ? m[1]!.toLowerCase() : null;
}

/** What to tell the Planner when Lumora's run of show changes: go to a cue, end, or nothing. */
export function linkAction(
  before: { running: boolean; cue: string | null },
  now: { running: boolean; cue: string | null },
): { action: 'go'; cue: string } | { action: 'end' } | null {
  if (now.running && now.cue && now.cue !== before.cue) return { action: 'go', cue: now.cue };
  if (before.running && !now.running && before.cue) return { action: 'end' };
  return null;
}

/**
 * Follows Lumora's run of show and tells the Planner (quietly: a failure, like
 * no internet or a cue deleted in the Planner, only skips that update).
 */
export function usePlannerLink(running: boolean, cueId: string | null, db: () => SupabaseClient | null): void {
  const last = useRef<{ running: boolean; cue: string | null }>({ running: false, cue: null });
  useEffect(() => {
    const now = { running, cue: plannerCueId(cueId) };
    const act = linkAction(last.current, now);
    last.current = now;
    const link = readLink();
    if (!act || !link) return;
    const client = db();
    if (!client) return;
    void Promise.resolve(
      client.rpc('planner_live_go', {
        p: link.planId,
        p_action: act.action,
        p_cue: act.action === 'go' ? act.cue : null,
        p_seconds: 0,
        p_message: null,
        p_flash: false,
        p_source: 'lumora',
      }),
    ).catch(() => {});
  }, [running, cueId, db]);
}
