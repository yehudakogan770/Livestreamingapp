import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { emptyShow } from './engine/client';
import { screenStatus } from './components/ScreenSelector';

async function start() {
  render(<App />);
  await act(async () => {});
}

async function addColour(name: string) {
  fireEvent.click(screen.getAllByRole('button', { name: /Add input/ })[0]!);
  const dialog = screen.getByRole('dialog', { name: 'Add input' });
  fireEvent.click(within(dialog).getByRole('button', { name: /^Colour/ }));
  fireEvent.change(within(dialog).getByPlaceholderText('Colour'), { target: { value: name } });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add input' }));
  });
}

const onAir = () => document.querySelector('.mon--pgm .mon__head em')?.textContent;
const next = () => document.querySelector('.mon--pvw .mon__head em')?.textContent;

describe('App shell', () => {
  it('starts on the Live Screen with the Live blade lit', async () => {
    await start();
    expect(screen.getByRole('tab', { name: /Live Screen/ })).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('svg[data-lit="live"]')).not.toBeNull();
  });

  it('F2 and F3 switch the screen being controlled and the logo follows', async () => {
    await start();
    fireEvent.keyDown(window, { key: 'F2' });
    expect(screen.getByRole('tab', { name: /Back Screen/ })).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('svg[data-lit="back"]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'F3' });
    expect(screen.getByRole('tab', { name: /Monitor/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Flash to get attention' })).toBeInTheDocument();
  });

  it('says when it is a browser demo rather than Lumora itself', async () => {
    await start();
    expect(screen.getByTestId('engine-status').textContent).toMatch(/browser demo/);
  });
});

describe('Main screen', () => {
  it('adds an input, lines it up next, and TAKE puts it on air', async () => {
    await start();
    await addColour('Stage red');
    expect(next()).toBe('Stage red');
    expect(onAir()).toBe('nothing');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^TAKE/ }));
    });
    expect(onAir()).toBe('Stage red');
    expect(screen.getByRole('tab', { name: /Live Screen/ }).textContent).toMatch(/ON AIR/);
  });

  it('keyboard: number lines up an input, Shift+Enter cuts it to air', async () => {
    await start();
    await addColour('One');
    await addColour('Two');
    await act(async () => {
      fireEvent.keyDown(window, { key: '1' });
    });
    expect(next()).toBe('One');
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter', shiftKey: true });
    });
    expect(onAir()).toBe('One');
    await act(async () => {
      fireEvent.keyDown(window, { key: '2' });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });
    expect(onAir()).toBe('Two');
  });

  it('double-click on a tile sends it straight to air', async () => {
    await start();
    await addColour('Logo');
    await act(async () => {
      fireEvent.doubleClick(screen.getByRole('button', { name: '1 Logo' }));
    });
    expect(onAir()).toBe('Logo');
  });

  it('tells the operator when the screen they control is blanked', async () => {
    await start();
    expect(screen.queryByText(/BLANKED/)).toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'b' });
    });
    expect(screen.getByText(/BLANKED/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'b' });
    });
    expect(screen.queryByText(/BLANKED/)).toBeNull();
  });

  it('PANIC needs a double-click, and one click brings the screens back', async () => {
    await start();
    const panic = screen.getByRole('button', { name: 'PANIC' });
    fireEvent.click(panic);
    expect(panic.textContent).toMatch(/Double-click/);
    await act(async () => {
      fireEvent.doubleClick(panic);
    });
    expect(panic).toHaveAttribute('aria-pressed', 'true');
    await act(async () => {
      fireEvent.click(panic);
    });
    expect(panic).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the engine’s reason when something is refused', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: /^Outputs/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open all three' }));
    });
    expect(screen.getAllByRole('status')[0]!.textContent).toMatch(/Not available in the browser demo/);
  });
});

describe('Stage monitor and countdown', () => {
  it('a quick message goes straight to the monitor, and Clear takes it off', async () => {
    await start();
    fireEvent.keyDown(window, { key: 'F3' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Please wrap up' }));
    });
    expect(document.querySelector('[data-monitor]')?.textContent).toMatch(/Please wrap up/);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear message' }));
    });
    expect(document.querySelector('[data-monitor]')?.textContent).not.toMatch(/Please wrap up/);
  });

  it('the countdown can be started and shown on the Live Screen', async () => {
    await start();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'On Live' }));
      fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(document.querySelector('.mon--pgm [data-countdown]')?.textContent).toMatch(/Starting soon/i);
  });
});

describe('screenStatus', () => {
  it('reports on air, blank and the panic states', () => {
    const show = emptyShow();
    expect(screenStatus(show, 'live')).toBe('idle');
    show.screens.live.program = 'src-1';
    expect(screenStatus(show, 'live')).toBe('on-air');
    show.backFollowsLive = true;
    expect(screenStatus(show, 'back')).toBe('following');
    show.screens.back.blank = true;
    expect(screenStatus(show, 'back')).toBe('blank');
    show.panic = true;
    expect(screenStatus(show, 'live')).toBe('blank');
    expect(screenStatus(show, 'monitor')).toBe('dimmed');
  });
});
