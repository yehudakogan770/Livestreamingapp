import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { emptyShow } from '../engine/client';
import { demoApply } from '../engine/demo';
import { defaultSlideshow } from '../engine/slideshow';
import type { Action } from '../engine/types/Action';
import type { Show } from '../engine/types/Show';
import { useClicker } from './useClicker';

function onAir(): Show {
  const sh = { ...defaultSlideshow(), slides: [{ type: 'image' as const, path: '/1.png' }] };
  const show = demoApply(emptyShow(), { type: 'addSource', source: { id: 'talk', name: 'Talk', kind: { type: 'slideshow', ...sh } } }, 0);
  show.screens.live = { ...show.screens.live, program: 'talk', preview: null };
  return show;
}

function Probe({ on, show, act }: { on: boolean; show: Show; act: (a: Action) => void }) {
  useClicker(on, show, 'live', act);
  return <input aria-label="typing" />;
}

describe('the clicker setting', () => {
  it('when on, clicker keys change the slideshow on air (and B blacks it, not the screen)', () => {
    const act = vi.fn();
    const other = vi.fn();
    window.addEventListener('keydown', other);
    render(<Probe on show={onAir()} act={act} />);
    fireEvent.keyDown(window, { key: 'PageDown' });
    fireEvent.keyDown(window, { key: 'PageUp' });
    fireEvent.keyDown(window, { key: 'b' });
    expect(act.mock.calls.map((c) => c[0])).toEqual([
      { type: 'slideNext', id: 'talk' },
      { type: 'slidePrevious', id: 'talk' },
      { type: 'slideBlack', id: 'talk', value: true },
    ]);
    // Nothing else hears those keys.
    expect(other).not.toHaveBeenCalled();
    window.removeEventListener('keydown', other);
  });

  it('leaves the keys alone when off, while typing, or with nothing to change', () => {
    const act = vi.fn();
    const { rerender, getByLabelText } = render(<Probe on={false} show={onAir()} act={act} />);
    fireEvent.keyDown(window, { key: 'PageDown' });
    rerender(<Probe on show={onAir()} act={act} />);
    fireEvent.keyDown(getByLabelText('typing'), { key: 'b' });
    rerender(<Probe on show={emptyShow()} act={act} />);
    fireEvent.keyDown(window, { key: 'PageDown' });
    expect(act).not.toHaveBeenCalled();
  });
});
