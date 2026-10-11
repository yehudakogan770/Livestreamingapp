import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { compact, defaultReactions, FLOAT_MS, floatAt, floating, react } from './reactions';
import { DemoClient } from './client';
import { demoApply } from './demo';
import { ReactionsCard } from '../views/ReactionsCard';
import type { Source } from './types/Source';

describe('reactions', () => {
  it('count every tap and float a dozen at most from one batch', () => {
    const r = defaultReactions();
    expect(react(r, [1, 0, 0, 0], 0)).toBe(false);
    r.open = true;
    expect(react(r, [500, 3, 0, 40], 1000)).toBe(true);
    expect(r.counts).toEqual([500, 3, 0, 40]);
    expect(r.floating).toHaveLength(12);
    expect(new Set(r.floating.map((f) => f.kind))).toEqual(new Set([0, 1, 3]));
    expect(floating(r, 1000)).toBe(true);
    expect(floating(r, 1000 + FLOAT_MS + 1000)).toBe(false);
  });

  it('rise on their side, fading away at the top', () => {
    const f = { kind: 0, at: 0, seed: 12345 };
    const start = floatAt(f, 'right', 10, 1920, 1080)!;
    const later = floatAt(f, 'right', 3500, 1920, 1080)!;
    expect(start.x).toBeGreaterThan(1920 * 0.75);
    expect(later.y).toBeLessThan(start.y);
    expect(later.alpha).toBeLessThan(1);
    expect(floatAt(f, 'left', 10, 1920, 1080)!.x).toBeLessThan(1920 * 0.25);
    expect(floatAt(f, 'right', FLOAT_MS, 1920, 1080)).toBeNull();
    expect(floatAt(f, 'right', -5, 1920, 1080)).toBeNull();
  });

  it('show big totals briefly', () => {
    expect([compact(999), compact(1234), compact(56_789), compact(1_500_000)]).toEqual(['999', '1.2K', '56.7K', '1.5M']);
  });

  it('are run from the control window', async () => {
    let show = (await new DemoClient().getShow()).show;
    show = demoApply(show, { type: 'addSource', source: { id: 'rx', name: 'Reactions', kind: { type: 'reactions', ...defaultReactions() } } }, 0);
    show = demoApply(show, { type: 'reactionsOpen', id: 'rx', value: true }, 1);
    show = demoApply(show, { type: 'react', id: 'rx', taps: [2, 0, 1, 0] }, 2);
    const src = show.sources.find((s) => s.id === 'rx') as Source;
    const act = vi.fn();
    render(<ReactionsCard source={src} act={act} client={new DemoClient()} onClose={() => {}} />);
    expect(screen.getByRole('list', { name: 'Totals' }).textContent).toBe('Love 2Haha 0Wow 1Yes 0');
    fireEvent.click(screen.getByRole('button', { name: /Stop taking reactions/ }));
    expect(act).toHaveBeenCalledWith({ type: 'reactionsOpen', id: 'rx', value: false });
    fireEvent.click(screen.getByRole('radio', { name: 'Left' }));
    expect(act.mock.calls.at(-1)![0]).toMatchObject({ type: 'updateReactions', reactions: { side: 'left' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start the totals again' }));
    expect(act).toHaveBeenCalledWith({ type: 'reactionsReset', id: 'rx' });
  });
});
