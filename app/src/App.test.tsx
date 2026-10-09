import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { emptyShow } from './engine/client';
import { screenStatus } from './components/ScreenSelector';

// These test the app itself, so the sign-in lock is open.
vi.mock('./auth/config', () => ({ AUTH_URL: '', AUTH_KEY: '', authOn: () => false }));

async function start({ keepSetup = false } = {}) {
  render(<App />);
  // The control window's part is loaded when the window opens (the first
  // time, the test runner compiles all of it: give it time).
  await screen.findByTestId('engine-status', {}, { timeout: 15000 });
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
  fireEvent.click(within(dialog).getByRole('button', { name: /^Color/ }));
  fireEvent.change(within(dialog).getByPlaceholderText('Color'), {
    target: { value: name },
  });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add input' }));
  });
}

const onAir = () => document.querySelector('.mon--pgm .mon__src')?.textContent;
const next = () => document.querySelector('.mon--pvw .mon__src')?.textContent;

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
    expect(screen.queryByText(/^Blanked$/)).toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'b' });
    });
    expect(screen.getByText(/^Blanked$/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'b' });
    });
    expect(screen.queryByText(/^Blanked$/)).toBeNull();
  });

  it('holding a key down does it once, never flicking the picture back and forth', async () => {
    await start();
    await addColour('One');
    await addColour('Two');
    await act(async () => {
      fireEvent.keyDown(window, { key: '1' });
      fireEvent.keyDown(window, { key: 'Enter', shiftKey: true });
      fireEvent.keyDown(window, { key: '2' });
    });
    // Enter held: the key repeats, but only the first press takes.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' });
      for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    });
    expect(onAir()).toBe('Two');
    await act(async () => {
      fireEvent.keyDown(window, { key: 'b' });
      fireEvent.keyDown(window, { key: 'b', repeat: true });
    });
    expect(screen.getByText(/^Blanked$/)).toBeInTheDocument();
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
      fireEvent.click(screen.getByRole('button', { name: 'Make one and put it in Next' }));
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

  it('a second countdown can be prepared in Next without touching the one on air', async () => {
    await start();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make one and put it in Next' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^TAKE/ }));
    });
    // The only countdown is on air, so Put in Next makes another one.
    fireEvent.click(screen.getByRole('button', { name: 'All countdown controls' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Put in Next' }));
    });
    expect(next()).toBe('Countdown 2');
    expect(screen.getByText('NEXT', { selector: '.cd__tag' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '+1 min' }));
    });
    expect(screen.getAllByRole('button', { name: /6:00/ }).length).toBeGreaterThan(0); // the one in Next
    expect(document.querySelector('.mon--pgm [data-countdown]')?.textContent).not.toMatch(/6:0/); // on air untouched
  });

  it('countdown settings change nothing until Done', async () => {
    await start();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make one and put it in Next' }));
    });
    if (!screen.queryByRole('button', { name: 'More…' })) fireEvent.click(screen.getByRole('button', { name: 'All countdown controls' }));
    fireEvent.click(screen.getByRole('button', { name: 'More…' }));
    fireEvent.change(screen.getByLabelText('Length'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByRole('button', { name: /5:00/ }).length).toBeGreaterThan(0);
    if (!screen.queryByRole('button', { name: 'More…' })) fireEvent.click(screen.getByRole('button', { name: 'All countdown controls' }));
    fireEvent.click(screen.getByRole('button', { name: 'More…' }));
    fireEvent.change(screen.getByLabelText('Length'), {
      target: { value: '2' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    });
    expect(screen.getAllByRole('button', { name: /2:00/ }).length).toBeGreaterThan(0);
  });
});

describe('Audio mixer', () => {
  it('is on the main screen with the Stream, Hall and Recording mixes', async () => {
    await start();
    const mixer = screen.getByLabelText('Audio mixer');
    expect(within(mixer).getByText('Stream')).toBeInTheDocument();
    expect(within(mixer).getByText('Hall')).toBeInTheDocument();
    expect(within(mixer).getByText('Recording')).toBeInTheDocument();
    expect(within(mixer).getByText(/No channels yet/)).toBeInTheDocument();
  });

  it('muting the Stream mix is one click', async () => {
    await start();
    const mixer = screen.getByLabelText('Audio mixer');
    const mute = within(mixer).getAllByRole('button', { name: 'Mute' })[0]!;
    await act(async () => {
      fireEvent.click(mute);
    });
    expect(
      within(screen.getByLabelText('Audio mixer')).getAllByRole('button', {
        name: 'Mute',
      })[0],
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Event setup', () => {
  it('asks about the event, the logo and emergencies at the start, and applies on Done', async () => {
    await start({ keepSetup: true });
    const dialog = screen.getByRole('dialog', { name: 'Event setup' });
    // A new, empty event first offers the templates (Start empty is chosen).
    expect(within(dialog).getByText('What kind of event?')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Start empty/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    fireEvent.change(within(dialog).getByPlaceholderText(/Spring Gala/), {
      target: { value: 'Chanukah Rally' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByText('If a camera or video stops working, that screen shows')).toBeInTheDocument();
    fireEvent.click(within(dialog).getAllByRole('button', { name: /The logo/ })[1]!);
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
    fireEvent.click(within(screen.getByLabelText('Presets')).getByRole('button', { name: 'Add' }));
    const dlg = screen.getByRole('dialog', { name: 'New preset' });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g. Speaker'), {
      target: { value: 'Speaker' },
    });
    fireEvent.click(within(dlg).getByRole('button', { name: /Cam B/ }));
    fireEvent.click(within(dlg).getByRole('button', { name: /Logo/ }));
    await act(async () => {
      fireEvent.click(within(dlg).getByRole('button', { name: 'Create preset' }));
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByLabelText('Presets')).getByRole('button', {
          name: /1\s*Speaker/,
        }),
      );
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
    fireEvent.click(within(screen.getByLabelText('Presets')).getByRole('button', { name: 'Add' }));
    const dlg = screen.getByRole('dialog', { name: 'New preset' });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g. Speaker'), {
      target: { value: 'Open' },
    });
    fireEvent.click(within(dlg).getByRole('button', { name: '+ Add button' }));
    fireEvent.change(within(dlg).getByLabelText('Add step'), {
      target: { value: 'cutTo' },
    });
    fireEvent.change(within(dlg).getByLabelText('Add step'), {
      target: { value: 'monitorMessage' },
    });
    await act(async () => {
      fireEvent.click(within(dlg).getByRole('button', { name: 'Create preset' }));
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByLabelText('Presets')).getByRole('button', {
          name: /1\s*Open/,
        }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Button 1' }));
    });
    expect(onAir()).toBe('Cam A');
  });
});

describe('Problems', () => {
  it('the bottom bar says all is good when nothing is wrong', async () => {
    await start();
    expect(screen.getByRole('button', { name: 'All good' })).toBeInTheDocument();
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

describe('Recording and streaming', () => {
  it('REC says plainly when this computer cannot record, and the show carries on', async () => {
    await start();
    // jsdom has no video encoder, like a web view without MediaRecorder.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'REC' }));
    });
    expect(screen.getAllByText(/Recording could not start/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /problem/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^TAKE/ })).toBeInTheDocument();
  });

  it('GO LIVE with nowhere to stream opens the settings to add a destination', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'GO LIVE' }));
    // (The settings window is loaded the first time it opens.)
    const dialog = await screen.findByRole('dialog', { name: 'Recording and streaming' }, { timeout: 10000 });
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Add a destination' }));
    expect(within(dialog).getByLabelText('Server address')).toHaveValue('rtmp://a.rtmp.youtube.com/live2');
    fireEvent.change(within(dialog).getByLabelText('Stream key'), {
      target: { value: 'secret' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    });
    // Now GO LIVE asks first, naming where it goes.
    fireEvent.click(screen.getByRole('button', { name: 'GO LIVE' }));
    expect(screen.getByText('The Live Screen goes out to YouTube.')).toBeInTheDocument();
  });
});

describe('12 Pesukim', () => {
  afterEach(() => localStorage.removeItem('lumora.jewishTools'));

  it('is hidden until the Jewish event tools are switched on in Settings', async () => {
    await start();
    expect(screen.queryByRole('button', { name: '12 Pesukim' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /Add input/ })[0]!);
    const add = screen.getByRole('dialog', { name: 'Add input' });
    expect(within(add).queryByRole('button', { name: /^12 Pesukim/ })).toBeNull();
    expect(within(add).queryByRole('button', { name: /Tanach/ })).toBeNull();
  });

  it('comes filled in; pasting changes them, then Space and the clicker keys move word by word; B hides only the words', async () => {
    localStorage.setItem('lumora.jewishTools', 'on');
    await start();
    fireEvent.click(screen.getAllByRole('button', { name: /Add input/ })[0]!);
    const add = screen.getByRole('dialog', { name: 'Add input' });
    fireEvent.click(within(add).getByRole('button', { name: /^12 Pesukim/ }));
    await act(async () => {
      fireEvent.click(within(add).getByRole('button', { name: 'Add input' }));
    });
    // The twelve come filled in, with how each word sounds and what it means.
    expect(screen.getByTestId('pesukim-now').textContent).toBe('תּוֹרָה');
    expect(document.querySelector('.pk__sound')?.textContent).toBe('Torah · The Torah');
    fireEvent.click(screen.getByRole('button', { name: 'Edit…' }));
    const ed = screen.getByRole('dialog', { name: '12 Pesukim' });
    fireEvent.click(within(ed).getByRole('button', { name: 'Paste all 12…' }));
    fireEvent.change(within(ed).getByLabelText('Paste the pesukim'), { target: { value: 'Mendel: תּוֹרָה צִוָּה לָנוּ\nשְׁמַע יִשְׂרָאֵל' } });
    fireEvent.click(within(ed).getByRole('button', { name: 'Use these' }));
    expect(within(ed).getByLabelText('Child for pasuk 1')).toHaveValue('Mendel');
    await act(async () => {
      fireEvent.click(within(ed).getByRole('button', { name: 'Done' }));
    });
    const now = () => screen.getByTestId('pesukim-now').textContent;
    expect(now()).toBe('תּוֹרָה');
    await act(async () => {
      fireEvent.keyDown(window, { key: ' ' });
      fireEvent.keyDown(window, { key: 'PageDown' });
    });
    expect(now()).toBe('לָנוּ');
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    expect(screen.getByLabelText('Go to pasuk')).toHaveValue('1');
    await act(async () => {
      fireEvent.keyDown(window, { key: 'b' });
    });
    expect(now()).toBe('words hidden');
    // B hid the words, not the whole screen.
    expect(screen.getByRole('button', { name: 'Live' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Overlays', () => {
  it('sets up overlay 1, puts it on air over the picture, and Shift+1 takes it off', async () => {
    await start();
    await addColour('#c7372f');
    fireEvent.click(screen.getByRole('button', { name: 'Set up overlay 1' }));
    const ed = screen.getByRole('dialog', { name: 'Overlays' });
    const input = within(ed).getByLabelText('Overlay input');
    const colour = within(input).getByRole('option', { name: '#c7372f' }) as HTMLOptionElement;
    fireEvent.change(input, { target: { value: colour.value } });
    fireEvent.click(within(ed).getByRole('button', { name: 'Logo, top right' }));
    expect(within(ed).getByLabelText('Left')).toHaveValue(86);
    await act(async () => {
      fireEvent.click(within(ed).getByRole('button', { name: 'Save and put on air' }));
    });
    const btn = document.querySelector('.ovbar__btn')!;
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.mon--pgm [data-overlay]')).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { key: '!', code: 'Digit1', shiftKey: true });
    });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Text', () => {
  it('adds a lower third with a name and title, shown on its tile', async () => {
    await start();
    fireEvent.click(screen.getAllByRole('button', { name: /Add input/ })[0]!);
    const add = screen.getByRole('dialog', { name: 'Add input' });
    fireEvent.click(within(add).getByRole('button', { name: /^Text \/ title/ }));
    fireEvent.change(within(add).getByLabelText('Text'), { target: { value: 'Rabbi Cohen' } });
    fireEvent.change(within(add).getByLabelText('Second line'), { target: { value: 'Head of School' } });
    await act(async () => {
      fireEvent.click(within(add).getByRole('button', { name: 'Add input' }));
    });
    const tile = document.querySelector('.tile [data-kind="text"]')!;
    expect(tile).toHaveTextContent('Rabbi Cohen');
    expect(tile).toHaveTextContent('Head of School');
  });
});

describe('Credits', () => {
  it('names pasted from a spreadsheet roll when taken to air, and pause works', async () => {
    await start();
    fireEvent.click(screen.getAllByRole('button', { name: /Add input/ })[0]!);
    const add = screen.getByRole('dialog', { name: 'Add input' });
    fireEvent.click(within(add).getByRole('button', { name: /^Credits \/ thank-you/ }));
    fireEvent.change(within(add).getByLabelText('Names'), { target: { value: 'Mendel K.\tChazzan\nChaya S.' } });
    await act(async () => {
      fireEvent.click(within(add).getByRole('button', { name: 'Add input' }));
    });
    await act(async () => {
      fireEvent.click(document.querySelector('.tile__pick')!);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });
    expect(screen.getByLabelText('Credits')).toHaveTextContent('2 names · rolling');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '❚❚ Pause' }));
    });
    expect(screen.getByLabelText('Credits')).toHaveTextContent('(paused)');
    expect(document.querySelector('.mon--pgm [data-kind="credits"]')).toHaveTextContent('Chazzan');
  });
});
