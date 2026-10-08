import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { AtemSettings, AtemStatus, SwitcherState } from '../engine/atem';
import type { Source } from '../engine/types/Source';

const calls: { cmd: string; args: unknown }[] = [];
let status: AtemStatus;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: { settings?: AtemSettings }) => {
    calls.push({ cmd, args });
    if (cmd === 'atem_status') return Promise.resolve(status);
    if (cmd === 'atem_set') {
      status = { ...status, settings: args!.settings! };
      return Promise.resolve(status);
    }
    if (cmd === 'atem_send') return Promise.resolve();
    return Promise.reject(new Error(cmd));
  },
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));

const { AtemDialog } = await import('./AtemDialog');
const { DeckLinkPicker } = await import('./DeckLinkPicker');

function switcher(): SwitcherState {
  return {
    model: 'ATEM Mini Pro',
    protocol: [2, 30],
    videoMode: 13,
    fps: 59.94,
    inputs: {
      '1': { id: 1, longName: 'Camera 1', shortName: 'CAM1', portType: 0 },
      '2': { id: 2, longName: 'Pulpit', shortName: 'PLPT', portType: 0 },
    },
    mixEffects: [
      {
        program: 1,
        preview: 2,
        style: 'mix',
        mixRate: 30,
        inTransition: false,
        tbar: 0,
        ftbBlack: false,
        ftbInTransition: false,
        ftbRate: 25,
        uskOnAir: [false],
      },
    ],
    dsks: [{ onAir: true, inTransition: false }],
    macros: [{ index: 0, name: 'Intro' }],
    macroRunning: null,
    tally: {},
    complete: true,
  };
}

const sources = [
  { id: 'a', name: 'Camera 1', kind: { type: 'camera', deviceId: 'x', label: 'Camera 1' } },
  { id: 'b', name: 'ATEM program', kind: { type: 'stream', url: 'decklink://DeckLink Mini Recorder', bufferMs: 0 } },
] as unknown as Source[];

beforeAll(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});
afterAll(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});
beforeEach(() => {
  calls.length = 0;
  status = {
    settings: { host: '', connect: false, mapping: [], drive: false, driveHow: 'transition', driveBlank: false, follow: true, programInput: null },
    connection: 'off',
    detail: null,
    state: null,
  };
});

describe('ATEM switcher dialog', () => {
  it('connects to the address typed', async () => {
    render(<AtemDialog sources={sources} onClose={() => {}} />);
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Switcher address'), { target: { value: ' 192.168.10.240 ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    });
    const set = calls.find((c) => c.cmd === 'atem_set')!.args as { settings: AtemSettings };
    expect(set.settings.host).toBe('192.168.10.240');
    expect(set.settings.connect).toBe(true);
  });

  it('switches the ATEM, maps inputs and drives it from Lumora', async () => {
    status = { ...status, settings: { ...status.settings, host: '10.0.0.9', connect: true }, connection: 'connected', state: switcher() };
    render(<AtemDialog sources={sources} onClose={() => {}} />);
    expect(await screen.findByText('Connected to ATEM Mini Pro')).toBeInTheDocument();
    // Program bus: Camera 1 is on air.
    const program = screen.getAllByRole('button', { name: 'CAM1' })[0]!;
    expect(program).toHaveAttribute('aria-pressed', 'true');
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'PLPT' })[0]!);
      fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
      fireEvent.click(screen.getByRole('button', { name: 'Fade to black' }));
      fireEvent.click(screen.getByRole('button', { name: /Intro/ }));
    });
    const sent = calls.filter((c) => c.cmd === 'atem_send').map((c) => (c.args as { commands: unknown[] }).commands[0]);
    expect(sent).toEqual([
      { type: 'program', me: 0, input: 2 },
      { type: 'cut', me: 0 },
      { type: 'fadeToBlack', me: 0 },
      { type: 'runMacro', index: 0 },
    ]);
    // Match by name pairs Lumora's Camera 1 with the ATEM's.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Match by name/ }));
    });
    expect(status.settings.mapping).toEqual([{ sourceId: 'a', atemInput: 1 }]);
    expect(screen.getByLabelText('ATEM input for Camera 1')).toHaveValue('1');
    // Lumora drives the ATEM, with cuts.
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /Lumora drives the ATEM/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Always a cut' }));
    });
    expect(status.settings.drive).toBe(true);
    expect(status.settings.driveHow).toBe('cut');
    // The ATEM's program comes in on the capture card input.
    await act(async () => {
      fireEvent.change(screen.getByLabelText('The input carrying the ATEM’s program'), { target: { value: 'b' } });
    });
    expect(status.settings.programInput).toBe('b');
  });
});

describe('capture card picker', () => {
  it('explains how to install Desktop Video when it is missing', async () => {
    const onChange = vi.fn();
    const core = await import('@tauri-apps/api/core');
    vi.spyOn(core, 'invoke').mockImplementation((cmd: string) =>
      cmd === 'decklink_devices' ? Promise.reject(new Error('Blackmagic Desktop Video isn’t installed.')) : Promise.resolve([]),
    );
    render(<DeckLinkPicker onChange={onChange} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Desktop Video isn’t installed');
    expect(onChange).toHaveBeenLastCalledWith(null);
    vi.restoreAllMocks();
  });

  it('chooses the only card, its connector and audio pair', async () => {
    const onChange = vi.fn();
    const core = await import('@tauri-apps/api/core');
    vi.spyOn(core, 'invoke').mockImplementation((cmd: string) =>
      Promise.resolve(
        cmd === 'decklink_devices'
          ? [
              {
                name: 'DeckLink Duo (1)',
                model: 'DeckLink Duo 2',
                canCapture: true,
                canPlayout: true,
                inputs: ['sdi', 'hdmi'],
                outputs: ['sdi'],
                detectsFormat: true,
                audioChannels: 16,
              },
            ]
          : [],
      ),
    );
    render(<DeckLinkPicker onChange={onChange} />);
    expect(await screen.findByRole('button', { name: 'DeckLink Duo (1)' })).toHaveAttribute('aria-pressed', 'true');
    expect(onChange).toHaveBeenLastCalledWith('decklink://DeckLink Duo (1)?input=sdi');
    fireEvent.click(screen.getByRole('button', { name: 'HDMI' }));
    fireEvent.change(screen.getByLabelText('Audio channels'), { target: { value: '1' } });
    expect(onChange).toHaveBeenLastCalledWith('decklink://DeckLink Duo (1)?input=hdmi&audio=3-4');
    expect(screen.getByText(/finds the picture’s format by itself/)).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
