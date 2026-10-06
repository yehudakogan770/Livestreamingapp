import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stepsBackToList, visit } from './App';
import { cardDismissed, dismissCard, installCard, installOffer, isIos } from './pwa';
import { InstallCard } from './PwaBars';
import { PULL_MAX, pullDistance } from './touch';

const env = { standalone: false, ios: false, canPrompt: false, dismissed: false, mobile: true };

describe('the install card', () => {
  it('offers Chrome’s install prompt when there is one', () => {
    expect(installCard({ ...env, canPrompt: true, mobile: true })).toBe('prompt');
  });

  it('shows the Share steps on iPhone and iPad (Safari has no prompt)', () => {
    expect(installCard({ ...env, ios: true })).toBe('ios');
  });

  it('never asks on a computer', () => {
    expect(installCard({ ...env, canPrompt: true, mobile: false })).toBeNull();
    expect(installOffer({ standalone: false, ios: false, canPrompt: true, mobile: false })).toBeNull();
  });

  it('shows nothing where neither is possible', () => {
    expect(installCard(env)).toBeNull();
  });

  it('shows nothing once installed, or once closed', () => {
    expect(installCard({ ...env, ios: true, canPrompt: true, standalone: true })).toBeNull();
    expect(installCard({ ...env, ios: true, dismissed: true })).toBeNull();
    expect(installCard({ ...env, canPrompt: true, dismissed: true })).toBeNull();
  });

  it('the account menu still offers to install after the card was closed, but not in the installed app', () => {
    expect(installOffer({ standalone: false, ios: false, canPrompt: true, mobile: true })).toBe('prompt');
    expect(installOffer({ standalone: true, ios: false, canPrompt: true, mobile: true })).toBeNull();
  });

  it('is closed for good on this device', () => {
    localStorage.clear();
    expect(cardDismissed()).toBe(false);
    dismissCard();
    expect(cardDismissed()).toBe(true);
  });

  it('tells iPhone users to tap Share, then Add to Home Screen', () => {
    const close = vi.fn();
    const { container } = render(<InstallCard kind="ios" onClose={close} />);
    expect(container.textContent).toMatch(/Tap\s+Share/);
    expect(container.textContent).toMatch(/Add to Home Screen/);
    expect(container.querySelectorAll('svg.share-icon').length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalled();
  });

  it('has an Install app button where Chrome can install it', () => {
    render(<InstallCard kind="prompt" onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /Install app/ })).toBeTruthy();
  });
});

describe('telling iPhones and iPads apart', () => {
  it('knows iPhones, and iPads that say they are Macs', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe(false);
    expect(isIos('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 'Linux armv8l', 5)).toBe(false);
  });
});

describe('Back, as the phone’s back button does it', () => {
  it('keeps the pages visited, and steps back off them', () => {
    let s = ['#/'];
    s = visit(s, '#/plan/x');
    s = visit(s, '#/plan/x/chat');
    expect(s).toEqual(['#/', '#/plan/x', '#/plan/x/chat']);
    s = visit(s, '#/plan/x');
    expect(s).toEqual(['#/', '#/plan/x']);
  });

  it('leaving a plan goes back to the list it came from, past its tabs', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    expect(stepsBackToList(['#/', `#/plan/${id}`])).toBe(-1);
    expect(stepsBackToList(['#/calendar', `#/plan/${id}`, `#/plan/${id}/schedule`])).toBe(-2);
  });

  it('a plan opened straight from a link has no list to go back to', () => {
    expect(stepsBackToList(['#/plan/11111111-2222-3333-4444-555555555555'])).toBe(0);
  });
});

describe('pull to refresh', () => {
  beforeEach(() => localStorage.clear());
  it('follows the finger at half speed, up to a limit', () => {
    expect(pullDistance(-20)).toBe(0);
    expect(pullDistance(40)).toBe(20);
    expect(pullDistance(1000)).toBe(PULL_MAX);
  });
});
