import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { blankCue } from '../../../planner/src/model';
import { planScript } from './fromPlanner';
import { linkAction, plannerCueId, readLink, usePlannerLink, writeLink } from './plannerLink';

const A = '11111111-2222-4333-8444-555555555555';
const B = '66666666-7777-4888-9999-000000000000';
const PLAN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('Lumora → Planner', () => {
  beforeEach(() => localStorage.clear());

  it('knows which Planner cue a Lumora cue came from', () => {
    expect(plannerCueId(`planner-${A}`)).toBe(A);
    expect(plannerCueId(`planner-${A}-lzx3-2`)).toBe(A);
    expect(plannerCueId('cue-abc')).toBeNull();
    expect(plannerCueId(null)).toBeNull();
  });

  it('goes to each new cue, and ends when the show stops', () => {
    expect(linkAction({ running: false, cue: null }, { running: true, cue: A })).toEqual({ action: 'go', cue: A });
    expect(linkAction({ running: true, cue: A }, { running: true, cue: A })).toBeNull();
    expect(linkAction({ running: true, cue: A }, { running: true, cue: B })).toEqual({ action: 'go', cue: B });
    expect(linkAction({ running: true, cue: B }, { running: false, cue: null })).toEqual({ action: 'end' });
    expect(linkAction({ running: true, cue: null }, { running: true, cue: null })).toBeNull();
  });

  it('keeps the plan to follow', () => {
    expect(readLink()).toBeNull();
    writeLink({ planId: PLAN, planName: 'Gala' });
    expect(readLink()).toEqual({ planId: PLAN, planName: 'Gala' });
    writeLink(null);
    expect(readLink()).toBeNull();
  });

  it('tells the Planner only when linked to a plan', () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const db = () => ({ rpc }) as unknown as SupabaseClient;
    const { rerender } = renderHook(({ running, cue }) => usePlannerLink(running, cue, db), {
      initialProps: { running: true, cue: `planner-${A}` as string | null },
    });
    expect(rpc).not.toHaveBeenCalled();
    writeLink({ planId: PLAN, planName: 'Gala' });
    rerender({ running: true, cue: `planner-${B}` });
    expect(rpc).toHaveBeenCalledWith('planner_live_go', expect.objectContaining({ p: PLAN, p_action: 'go', p_cue: B, p_source: 'lumora' }));
    rerender({ running: false, cue: null });
    expect(rpc).toHaveBeenLastCalledWith('planner_live_go', expect.objectContaining({ p_action: 'end', p_cue: null }));
  });

  it('puts the scripts together for the prompter', () => {
    const cues = [
      { ...blankCue('p', 'b', 2), title: 'Thanks', script: 'Thank you all.' },
      { ...blankCue('p', 'a', 1), title: 'Welcome', script: 'Good evening.' },
      { ...blankCue('p', 'c', 3), title: 'Spare', script: 'Not tonight.', skip: true },
      { ...blankCue('p', 'd', 4), title: 'Video' },
    ];
    expect(planScript(cues)).toBe('WELCOME\n\nGood evening.\n\n\nTHANKS\n\nThank you all.');
  });
});
