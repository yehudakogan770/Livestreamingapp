import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { emptyShow } from './engine/client';
import { screenStatus } from './components/ScreenSelector';

describe('App shell', () => {
  it('starts on the Live Screen with the Live blade lit', async () => {
    render(<App />);
    await act(async () => {});
    expect(screen.getByRole('tab', { name: /Live Screen/ })).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('svg[data-lit="live"]')).not.toBeNull();
  });

  it('F2 and F3 switch the screen being controlled and the logo follows', async () => {
    render(<App />);
    await act(async () => {});
    fireEvent.keyDown(window, { key: 'F2' });
    expect(screen.getByRole('tab', { name: /Back Screen/ })).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('svg[data-lit="back"]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'F3' });
    expect(screen.getByRole('tab', { name: /Monitor/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows it is a browser preview when not inside the app', async () => {
    render(<App />);
    await act(async () => {});
    expect(screen.getByTestId('engine-status').textContent).toMatch(/browser preview/);
  });
});

describe('screenStatus', () => {
  it('reports on air, blank and the panic states', () => {
    const show = emptyShow();
    expect(screenStatus(show, 'live')).toBe('idle');
    show.screens.live.program = 'src-1';
    expect(screenStatus(show, 'live')).toBe('on-air');
    show.screens.back.blank = true;
    expect(screenStatus(show, 'back')).toBe('blank');
    show.panic = true;
    expect(screenStatus(show, 'live')).toBe('blank');
    expect(screenStatus(show, 'monitor')).toBe('dimmed');
  });
});
