import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DemoClient } from '../engine/client';
import { demoApply } from '../engine/demo';
import type { Action } from '../engine/types/Action';
import type { Show } from '../engine/types/Show';
import { describeWhen, freshWhen, KINDS, TriggersDialog } from './TriggersDialog';

async function showWith(): Promise<Show> {
  let s = (await new DemoClient().getShow()).show;
  s = demoApply(s, { type: 'addSource', source: { id: 'mic', name: 'Lectern mic', kind: { type: 'microphone', deviceId: 'd', label: 'Mic' } } }, 0);
  s = demoApply(s, { type: 'addSource', source: { id: 'cam', name: 'Stage camera', kind: { type: 'camera', deviceId: 'c', label: 'Cam' } } }, 0);
  return s;
}

describe('triggers dialog', () => {
  it('every kind starts with sensible choices and reads in plain words', async () => {
    const s = await showWith();
    for (const k of KINDS) {
      const w = freshWhen(k.type, s);
      expect(w.type).toBe(k.type);
      expect(describeWhen(w, s)).toMatch(/^(When|Every)/);
    }
    expect(freshWhen('sound', s)).toMatchObject({ sourceId: 'mic', above: true, db: -30 });
    expect(freshWhen('inputLost', s)).toMatchObject({ sourceId: 'cam' });
    expect(describeWhen({ type: 'sound', sourceId: 'mic', above: false, db: -50, holdMs: 10_000 }, s)).toBe(
      'When “Lectern mic” is quieter than -50 dB for 10 s',
    );
    expect(describeWhen({ type: 'broadcast', what: 'stream', on: true }, s)).toBe('When the stream starts');
  });

  it('switches a trigger to a sound level and sets how loud and how long', async () => {
    let s = await showWith();
    s = demoApply(
      s,
      { type: 'setTriggers', triggers: [{ id: 't1', name: 'Speaker', enabled: true, when: freshWhen('videoEnds', s), steps: [], lastFired: 0 }] },
      0,
    );
    const acts: Action[] = [];
    const act = vi.fn((a: Action) => acts.push(a));
    const { rerender } = render(<TriggersDialog show={s} act={act} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('When'), { target: { value: 'sound' } });
    const set = acts.at(-1)!;
    expect(set.type).toBe('setTriggers');
    if (set.type !== 'setTriggers') return;
    s = demoApply(s, set, 1);
    rerender(<TriggersDialog show={s} act={act} onClose={() => {}} />);
    expect(screen.getByLabelText('Which input')).toHaveValue('mic');
    fireEvent.change(screen.getByLabelText('For at least, seconds'), { target: { value: '2.5' } });
    const last = acts.at(-1)!;
    expect(last.type === 'setTriggers' && last.triggers[0]!.when).toMatchObject({ type: 'sound', holdMs: 2500 });
  });
});
