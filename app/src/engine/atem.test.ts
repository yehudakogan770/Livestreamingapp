import { describe, expect, it } from 'vitest';
import { atemInputName, atemInputs, connectionLine, defaultAtemSettings, setMapping, suggestMapping, tallyOf, type SwitcherState } from './atem';
import type { Source } from './types/Source';

function switcher(over: Partial<SwitcherState> = {}): SwitcherState {
  return {
    model: 'ATEM Mini Pro',
    protocol: [2, 30],
    videoMode: 13,
    fps: 59.94,
    inputs: {
      '1': { id: 1, longName: 'Camera 1', shortName: 'CAM1', portType: 0 },
      '2': { id: 2, longName: 'Pulpit', shortName: 'PLPT', portType: 0 },
      '1000': { id: 1000, longName: 'Color Bars', shortName: 'Bars', portType: 2 },
      '0': { id: 0, longName: 'Black', shortName: 'Blk', portType: 1 },
      '10010': { id: 10010, longName: 'Program', shortName: 'Pgm', portType: 128 },
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
    dsks: [{ onAir: false, inTransition: false }],
    macros: [{ index: 0, name: 'Intro' }],
    macroRunning: null,
    tally: {},
    complete: true,
    ...over,
  };
}

const src = (id: string, name: string, type: 'camera' | 'stream' | 'color'): Source =>
  ({
    id,
    name,
    kind: type === 'camera' ? { type, deviceId: id, label: name } : type === 'stream' ? { type, url: 'decklink://x', bufferMs: 0 } : { type, color: '#000' },
  }) as unknown as Source;

describe('ATEM switcher', () => {
  it('lists cameras first, then black, bars and the rest; outputs are left out', () => {
    expect(atemInputs(switcher()).map((i) => i.id)).toEqual([1, 2, 0, 1000]);
    expect(atemInputs(null)).toEqual([]);
    expect(atemInputName(switcher(), 2)).toBe('Pulpit');
    expect(atemInputName(switcher(), 7)).toBe('Input 7');
  });

  it('matches Lumora inputs to ATEM inputs by name, keeping rows already set', () => {
    const sources = [src('a', 'Camera 1', 'camera'), src('b', 'pulpit', 'stream'), src('c', 'Camera 1', 'color'), src('d', 'Balcony', 'camera')];
    expect(suggestMapping(sources, switcher(), [])).toEqual([
      { sourceId: 'a', atemInput: 1 },
      { sourceId: 'b', atemInput: 2 },
    ]);
    // A row set by hand stays as it is.
    expect(suggestMapping(sources, switcher(), [{ sourceId: 'a', atemInput: 2 }])).toEqual([
      { sourceId: 'a', atemInput: 2 },
      { sourceId: 'b', atemInput: 2 },
    ]);
    expect(setMapping([{ sourceId: 'a', atemInput: 1 }], 'a', 3)).toEqual([{ sourceId: 'a', atemInput: 3 }]);
    expect(setMapping([{ sourceId: 'a', atemInput: 1 }], 'a', null)).toEqual([]);
  });

  it('reads tally from the switcher’s list, or from program and preview', () => {
    expect(tallyOf(switcher(), 1)).toBe('program');
    expect(tallyOf(switcher(), 2)).toBe('preview');
    expect(tallyOf(switcher(), 3)).toBeNull();
    const t = switcher({ tally: { '3': { program: true, preview: false }, '1': { program: false, preview: false } } });
    expect(tallyOf(t, 3)).toBe('program');
    expect(tallyOf(t, 1)).toBeNull();
  });

  it('says how the connection is doing', () => {
    const settings = { ...defaultAtemSettings(), host: '10.0.0.9', connect: true };
    expect(connectionLine({ settings, connection: 'connected', detail: null, state: switcher() })).toBe('Connected to ATEM Mini Pro');
    expect(connectionLine({ settings, connection: 'connecting', detail: null, state: null })).toBe('Connecting to 10.0.0.9…');
    expect(connectionLine({ settings, connection: 'retrying', detail: 'The switcher doesn’t answer.', state: null })).toMatch(/doesn’t answer/);
    expect(connectionLine({ settings: defaultAtemSettings(), connection: 'off', detail: null, state: null })).toBe('Not connected');
  });
});
