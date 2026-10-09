import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshDevice } from './device';

vi.mock('../../app/src/auth/config', () => ({ authOn: () => true }));
vi.mock('./session', () => ({
  db: () => ({}),
  whoAmI: () =>
    Promise.resolve({
      s: 'in',
      canPlan: true,
      access: { userId: 'me', name: 'Pat Morgan', email: 'pat@example.org', state: 'ok' },
    }),
  onSignInChange: () => () => {},
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('./api', () => ({ listPlans: () => Promise.resolve([]), createPlan: vi.fn() }));
vi.mock('./apiPro', () => ({
  listTemplates: () => Promise.resolve([]),
  loadNotices: () => Promise.reject(new Error('none')),
  watchNotices: () => () => {},
  myFeed: vi.fn(),
  feedUrl: () => '',
}));

const { App } = await import('./App');

/** A browser: its user agent, what its pointer is, and the window's size. */
function browser(ua: string, pointer: 'fine' | 'coarse', width: number, height: number) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  window.matchMedia = ((q: string) => ({
    matches: q.includes(`pointer: ${pointer}`),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  Object.assign(window, { innerWidth: width, innerHeight: height });
  refreshDevice();
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

describe('the layout follows the device, not only the width', () => {
  it('a computer with a narrow window keeps the sidebar, not the phone tab bar', async () => {
    browser(WINDOWS, 'fine', 600, 800);
    const { container } = render(<App />);
    await act(async () => {});
    expect(document.documentElement.dataset.device).toBe('computer');
    expect('compact' in document.documentElement.dataset).toBe(true);
    expect(container.querySelector('.tabbar')).toBeNull();
    expect(container.querySelector('.side--rail')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Open the sidebar' })).toBeTruthy();
    // No pull-to-refresh on a computer.
    expect(container.querySelector('.pull')).toBeNull();
  });

  it('a phone gets the tab bar', async () => {
    browser(PIXEL, 'coarse', 412, 915);
    const { container } = render(<App />);
    await act(async () => {});
    expect(document.documentElement.dataset.device).toBe('phone');
    expect(container.querySelector('.tabbar')).not.toBeNull();
    expect(container.querySelector('.side')).toBeNull();
  });

  it('a wide computer window shows the whole sidebar, with the keyboard shortcuts in the account menu', async () => {
    browser(WINDOWS, 'fine', 1440, 900);
    const { container } = render(<App />);
    await act(async () => {});
    expect(container.querySelector('.side')).not.toBeNull();
    expect(container.querySelector('.side--rail')).toBeNull();
    act(() => screen.getByRole('button', { name: /^Account/ }).click());
    expect(screen.getByRole('group', { name: 'Keyboard shortcuts' }).textContent).toContain('New cue');
  });
});
