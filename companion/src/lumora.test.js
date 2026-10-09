import { describe, expect, it } from 'vitest';
import { ACTIONS, commandFor, presetsFor, retryDelay, socketUrl, tallyOf, variablesOf } from './lumora.js';

const tally = {
  live: { program: 2, programName: 'Pulpit', preview: 3, previewName: 'Wide' },
  inputs: [
    { number: 1, name: 'Camera 1', program: false, preview: false },
    { number: 2, name: 'Pulpit', program: true, preview: false },
    { number: 3, name: 'Wide', program: false, preview: true },
  ],
  overlays: [true, false],
  recording: true,
  streaming: false,
  reconnecting: 3,
};

describe('Companion module', () => {
  it('turns actions into the API’s commands', () => {
    expect(commandFor('cut', {})).toEqual({ cmd: 'cut', screen: 'live' });
    expect(commandFor('preview', { input: '3' })).toEqual({ cmd: 'preview', input: '3', screen: 'live' });
    expect(commandFor('program', { input: 'Pulpit', screen: 'back' })).toEqual({ cmd: 'cutto', name: 'Pulpit', screen: 'back' });
    expect(commandFor('overlay', { channel: 2, state: 'on' })).toEqual({ cmd: 'overlay', channel: '2', state: 'on' });
    expect(commandFor('replay', { seconds: 5, slow: true })).toEqual({ cmd: 'replay', seconds: '5', slow: '1' });
    expect(commandFor('replay', { seconds: 5, slow: false })).toEqual({ cmd: 'replay', seconds: '5' });
    expect(commandFor('macro', { name: 'Start show' })).toEqual({ cmd: 'macro', name: 'Start show' });
    expect(commandFor('macro', { name: '2' })).toEqual({ cmd: 'macro', number: '2' });
    expect(commandFor('timer', { do: 'start' })).toEqual({ cmd: 'timer', do: 'start' });
    expect(commandFor('timer', { do: 'add', minutes: 5 })).toEqual({ cmd: 'timer', do: 'add', minutes: '5' });
    expect(commandFor('titlerfield', { input: 'Lower third', field: 'name', value: 'Ada' })).toEqual({
      cmd: 'titler',
      name: 'Lower third',
      field: 'name',
      value: 'Ada',
    });
    expect(commandFor('titlerdo', { input: '4', do: 'toggle' })).toEqual({ cmd: 'titler', input: '4', do: 'toggle' });
    expect(commandFor('titlerdo', { input: '4', do: 'start', field: 'clock' })).toEqual({ cmd: 'titler', input: '4', do: 'start', field: 'clock' });
    expect(commandFor('atem', {})).toEqual({ cmd: 'atem', do: 'cut' });
    expect(commandFor('atem', { do: 'program', atemInput: 3 })).toEqual({ cmd: 'atem', do: 'program', input: '3' });
    expect(commandFor('atem', { do: 'dsk', keyer: 2, state: 'on' })).toEqual({ cmd: 'atem', do: 'dsk', keyer: '2', state: 'on' });
    expect(commandFor('atem', { do: 'macro', number: 4 })).toEqual({ cmd: 'atem', do: 'macro', number: '4' });
    expect(commandFor('nope', {})).toBeNull();
  });

  it('every action sends a command Lumora knows', () => {
    const known = new Set([
      'take',
      'cut',
      'preview',
      'cutto',
      'playnow',
      'overlay',
      'overlaysoff',
      'blank',
      'ftb',
      'record',
      'stream',
      'replay',
      'slide',
      'preset',
      'nextpreset',
      'previouspreset',
      'macro',
      'stopmacros',
      'timer',
      'datarow',
      'titler',
      'nextcue',
      'panic',
      'atem',
    ]);
    for (const a of Object.values(ACTIONS)) expect(known.has(a.cmd)).toBe(true);
  });

  it('reads the tally by number or name', () => {
    expect(tallyOf(tally, '2')).toBe('program');
    expect(tallyOf(tally, 'wide')).toBe('preview');
    expect(tallyOf(tally, 1)).toBe('off');
    expect(tallyOf(tally, '9')).toBe('off');
    expect(tallyOf(null, '1')).toBe('off');
  });

  it('fills the variables, with the reconnecting try', () => {
    const v = variablesOf(tally);
    expect(v.program).toBe('Pulpit');
    expect(v.recording).toBe('on');
    expect(v.streaming).toBe('reconnecting (3)');
    expect(v.input_3_name).toBe('Wide');
  });

  it('waits longer each time, up to 30 seconds', () => {
    expect([0, 1, 2, 3, 10].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 30000]);
  });

  it('puts the token in the address', () => {
    expect(socketUrl({ host: '192.168.1.20', port: 8095, token: 'a b' })).toBe('ws://192.168.1.20:8095/api/ws?token=a%20b');
  });

  it('has presets that use real actions and feedbacks', () => {
    const p = presetsFor(4);
    expect(p.preview_4.feedbacks.map((f) => f.options.state)).toEqual(['program', 'preview']);
    for (const b of Object.values(p)) expect(ACTIONS[b.steps[0].down[0].actionId]).toBeDefined();
  });
});
