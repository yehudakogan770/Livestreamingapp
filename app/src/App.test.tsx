import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { emptyShow } from './engine/client';
import { screenStatus } from './components/ScreenSelector';

async function start({ keepSetup = false } = {}) {
  render(<App />);
  await act(async () => {});
  // A new show asks the event setup questions first; most tests skip them.
  if (!keepSetup) {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    });
  }
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

  it('the countdown goes to Next first, and only TAKE puts it on air', async () => {
    await start();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Put in Next' }));
    });
    expect(next()).toBe('Countdown');
    expect(onAir()).toBe('nothing');
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument(); // waiting in Next
    expect(document.querySelector('.mon--pvw [data-countdown]')?.textContent).toMatch(/Starting soon/i);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^TAKE/ }));
    });
    expect(onAir()).toBe('Countdown');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument(); // counting once on air
  });

  it('countdown settings change nothing until Done', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'More…' }));
    fireEvent.change(screen.getByLabelText('Length'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: /5:00/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More…' }));
    fireEvent.change(screen.getByLabelText('Length'), { target: { value: '2' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    });
    expect(screen.getByRole('button', { name: /2:00/ })).toBeInTheDocument();
  });
});

describe('Audio mixer', () => {
  it('is on the main screen with the Stream, Hall and Recording mixes', async () => {
    await start();
    const mixer = screen.getByLabelText('Audio mixer');
    expect(within(mixer).getByText('Stream')).toBeInTheDocument();
    expect(within(mixer).getByText('Hall')).toBeInTheDocument();
    expect(within(mixer).getByText('Recording')).toBeInTheDocument();
    expect(within(mixer).getByText(/Add a microphone/)).toBeInTheDocument();
  });

  it('muting the Stream mix is one click', async () => {
    await start();
    const mixer = screen.getByLabelText('Audio mixer');
    const mute = within(mixer).getAllByRole('button', { name: 'M' })[0]!;
    await act(async () => {
      fireEvent.click(mute);
    });
    expect(within(screen.getByLabelText('Audio mixer')).getAllByRole('button', { name: 'M' })[0]).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Event setup', () => {
  it('asks about the event, the logo and emergencies at the start, and applies on Done', async () => {
    await start({ keepSetup: true });
    const dialog = screen.getByRole('dialog', { name: 'Event setup' });
    fireEvent.change(within(dialog).getByPlaceholderText(/Chanukah Rally/), { target: { value: 'Chanukah Rally' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByText('If a camera or video stops working, that screen shows')).toBeInTheDocument();
    fireEvent.click(within(dialog).getAllByRole('button', { name: /The event logo/ })[1]!);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Go to black/ }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    });
    expect(screen.queryByRole('dialog', { name: 'Event setup' })).toBeNull();
    expect(screen.getByText(/Chanukah Rally · not saved to a file/)).toBeInTheDocument();
  });

  it('can be opened again from the Event menu', async () => {
    await start();
    expect(screen.queryByRole('dialog', { name: 'Event setup' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Event' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Event setup…' }));
    expect(screen.getByRole('dialog', { name: 'Event setup' })).toBeInTheDocument();
  });

  it('New event asks first, then starts clean with the setup questions', async () => {
    await start();
    await addColour('Red');
    fireEvent.click(screen.getByRole('button', { name: 'Event' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New event' }));
    expect(screen.getByText(/has not been saved to a file/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start a new event' }));
    });
    expect(screen.getByRole('dialog', { name: 'Event setup' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '1 Red' })).toBeNull();
  });
});

describe('Presets', () => {
  it('create a preset, pick it, and only its inputs show with its first one in Next', async () => {
    await start();
    await addColour('Cam A');
    await addColour('Cam B');
    await addColour('Logo');
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    const dlg = screen.getByRole('dialog', { name: 'New preset' });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g. Speaker'), { target: { value: 'Speaker' } });
    fireEvent.click(within(dlg).getByRole('button', { name: /Cam B/ }));
    fireEvent.click(within(dlg).getByRole('button', { name: /Logo/ }));
    await act(async () => {
      fireEvent.click(within(dlg).getByRole('button', { name: 'Create preset' }));
    });
    await act(async () => {
      fireEvent.click(within(screen.getByLabelText('Presets')).getByRole('button', { name: /1\s*Speaker/ }));
    });
    expect(next()).toBe('Cam B');
    expect(screen.queryByRole('button', { name: '1 Cam A' })).toBeNull();
    expect(screen.getByRole('button', { name: '2 Cam B' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show all inputs'));
    expect(screen.getByRole('button', { name: '1 Cam A' })).toBeInTheDocument();
  });

  it('a preset button runs its steps', async () => {
    await start();
    await addColour('Cam A');
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    const dlg = screen.getByRole('dialog', { name: 'New preset' });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g. Speaker'), { target: { value: 'Open' } });
    fireEvent.click(within(dlg).getByRole('button', { name: '+ Add button' }));
    fireEvent.change(within(dlg).getByLabelText('Add step'), { target: { value: 'cutTo' } });
    fireEvent.change(within(dlg).getByLabelText('Add step'), { target: { value: 'monitorMessage' } });
    await act(async () => {
      fireEvent.click(within(dlg).getByRole('button', { name: 'Create preset' }));
    });
    await act(async () => {
      fireEvent.click(within(screen.getByLabelText('Presets')).getByRole('button', { name: /1\s*Open/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Button 1' }));
    });
    expect(onAir()).toBe('Cam A');
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
