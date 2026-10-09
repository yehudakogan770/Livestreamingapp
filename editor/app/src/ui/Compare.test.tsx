import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { compare, CompareOverlay, MOST_STILLS } from './Compare';

describe('stills and the reference wipe', () => {
  it('keeps the newest stills, compares with one, and forgets one taken away', () => {
    for (let i = 0; i < MOST_STILLS + 3; i++) compare.add(`Shot ${i}`, `data:image/jpeg;base64,${i}`);
    expect(compare.state.stills).toHaveLength(MOST_STILLS);
    expect(compare.state.stills[0]?.name).toBe('Shot 3');
    const last = compare.state.stills.at(-1)!;
    compare.show(last.id);
    expect(compare.state.showing).toBe(last.id);
    compare.remove(last.id);
    expect(compare.state.showing).toBeNull();
  });

  it('shows the still left of the line, which moves with the keys and stays inside the picture', () => {
    const still = compare.add('Wide 01:00:10:00', 'data:image/jpeg;base64,AA');
    act(() => {
      compare.show(still.id);
      compare.wipe(0.5);
    });
    render(<CompareOverlay />);
    const img = screen.getByAltText('Still: Wide 01:00:10:00') as HTMLImageElement;
    expect(img.style.clipPath).toBe('inset(0 calc(100% - 50.00%) 0 0)');
    const line = screen.getByRole('slider', { name: /Wipe/ });
    fireEvent.keyDown(line, { key: 'ArrowRight' });
    expect(compare.state.at).toBeCloseTo(0.52);
    act(() => compare.wipe(2));
    expect(compare.state.at).toBe(1);
    act(() => compare.show(null));
    expect(screen.queryByRole('slider')).toBeNull();
  });
});
