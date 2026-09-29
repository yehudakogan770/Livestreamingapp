import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SourceView } from './SourceView';
import { SafeBoundary } from './SafeBoundary';
import { ProblemStore, ProblemsProvider } from '../problems/problems';
import { ProblemLight } from '../problems/ProblemsUI';
import { DemoClient } from '../engine/client';
import type { Source } from '../engine/types/Source';

const client = new DemoClient();
const picture: Source = {
  id: 'p',
  name: 'Logo',
  kind: { type: 'image', path: 'missing.png' },
  volume: 1,
  muted: false,
  looping: false,
  fit: 'contain',
  audio: { follow: true, toMaster: true, toA: true, toB: true, delayMs: 0 },
  key: { enabled: false, color: '#00b140', similarity: 0.4, smoothness: 0.08, spill: 0.3 },
};
const video: Source = {
  id: 'v',
  name: 'Opening',
  kind: { type: 'video', path: 'missing.mp4', durationS: 0, playback: { playing: false, posS: 0, at: 0 } },
  volume: 1,
  muted: false,
  looping: false,
  fit: 'contain',
  audio: { follow: true, toMaster: true, toA: true, toB: true, delayMs: 0 },
  key: { enabled: false, color: '#00b140', similarity: 0.4, smoothness: 0.08, spill: 0.3 },
};

describe('when a source fails', () => {
  it('an audience screen shows plain black, never an error message', () => {
    for (const src of [picture, video]) {
      const { container, unmount } = render(<SourceView source={src} client={client} audience />);
      fireEvent.error(container.querySelector('img, video')!);
      const failed = container.querySelector('[data-failed]') as HTMLElement;
      expect(failed).not.toBeNull();
      expect(failed.textContent).toBe('');
      expect(failed.style.background).toMatch(/(#000|rgb\(0, 0, 0\))/);
      unmount();
    }
  });

  it('the control window says what went wrong', () => {
    const { container } = render(<SourceView source={video} client={client} />);
    fireEvent.error(container.querySelector('video')!);
    expect(container.textContent).toMatch(/Video file not found/);
  });
});

describe('when a screen crashes', () => {
  function Broken(): never {
    throw new Error('boom');
  }

  it('an output goes black at once and reloads itself', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <SafeBoundary audience>
        <Broken />
      </SafeBoundary>,
    );
    expect(container.querySelector('[data-crashed]')).not.toBeNull();
    expect(container.textContent).toBe('');
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(reload).toHaveBeenCalled();
    Object.defineProperty(window, 'location', { configurable: true, value: original });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});

describe('the problem centre hears about it at once', () => {
  it('a picture that fails is listed with what to do, and the light turns red', () => {
    const store = new ProblemStore();
    const { container } = render(
      <ProblemsProvider store={store}>
        <ProblemLight />
        <SourceView source={picture} client={client} thumb />
      </ProblemsProvider>,
    );
    expect(container.textContent).toMatch(/All good/);
    act(() => {
      fireEvent.error(container.querySelector('img')!);
    });
    expect(store.snapshot()).toHaveLength(1);
    expect(store.snapshot()[0]).toMatchObject({ key: 'source:p', level: 'error', sourceId: 'p' });
    expect(store.snapshot()[0]!.fix).toMatch(/moved, renamed or deleted/);
    expect(container.textContent).toMatch(/1 problem/);
  });
});
