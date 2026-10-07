import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { lazyPart } from './lazyPart';

const Hello = ({ name }: { name: string }) => <p>Hello {name}</p>;

describe('lazyPart', () => {
  it('loads the part the first time it is shown, once', async () => {
    const load = vi.fn(() => Promise.resolve(Hello));
    const Part = lazyPart(load);
    expect(load).not.toHaveBeenCalled();
    render(<Part name="Dana" />);
    expect(await screen.findByText('Hello Dana')).toBeInTheDocument();
    render(<Part name="Avi" />);
    expect(await screen.findByText('Hello Avi')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('once preloaded, is drawn straight away', async () => {
    const Part = lazyPart(() => Promise.resolve(Hello));
    await Part.preload();
    render(<Part name="Dana" />);
    expect(screen.getByText('Hello Dana')).toBeInTheDocument();
  });

  it('keeps what it holds when it is drawn again after loading', async () => {
    let n = 0;
    const Counter = () => {
      const [id] = useState(() => ++n);
      return <p data-testid="c">{id}</p>;
    };
    const Part = lazyPart(() => Promise.resolve(Counter));
    const { rerender } = render(<Part />);
    await screen.findByTestId('c');
    await act(async () => rerender(<Part />));
    // The same one: not swapped for a new one now that the part is loaded.
    expect(screen.getByTestId('c').textContent).toBe('1');
  });

  it('tries again after a failed load', async () => {
    let fail = true;
    const Part = lazyPart(() => (fail ? Promise.reject(new Error('busy')) : Promise.resolve(Hello)));
    await expect(Part.preload()).rejects.toThrow('busy');
    fail = false;
    await expect(Part.preload()).resolves.toBe(Hello);
  });
});
