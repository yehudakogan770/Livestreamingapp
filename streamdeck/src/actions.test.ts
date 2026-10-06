// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { kindOf, needsHold, request, uuid, type Request } from './actions';
import { deckState, NO_APP } from './show';
import { sampleShow } from './testing';

/** What is sent (nothing for the Screen key and keys with nothing to do). */
const body = (r: Request) => ('body' in r ? r.body : null);

const state = (app = {}, show = sampleShow()) => deckState(show, { ...NO_APP, ...app });

describe('what each key sends', () => {
  it('TAKE and CUT, on the deck’s screen or the key’s own', () => {
    expect(request('take', {}, state(), 'live')).toEqual({ to: 'action', body: { type: 'take', screen: 'live' } });
    expect(body(request('take', { transition: 'dip' }, state(), 'back'))).toEqual({ type: 'take', screen: 'back', transition: 'dip' });
    expect(body(request('take', { transition: 'nonsense' }, state(), 'live'))).toEqual({ type: 'take', screen: 'live' });
    expect(body(request('cut', { screen: 'back' }, state(), 'live'))).toEqual({ type: 'take', screen: 'back', transition: 'cut' });
  });

  it('inputs: press lines up in Next, a double press cuts to air', () => {
    expect(body(request('input', { input: 'cam2' }, state(), 'live'))).toEqual({ type: 'setPreview', screen: 'live', sourceId: 'cam2' });
    expect(body(request('input', { input: 'cam2' }, state(), 'live', 'double'))).toEqual({ type: 'cutTo', screen: 'live', sourceId: 'cam2' });
    expect(body(request('input', { input: 'cam2', press: 'air' }, state(), 'live'))).toEqual({ type: 'cutTo', screen: 'live', sourceId: 'cam2' });
    expect(request('input', {}, state(), 'live')).toEqual({ to: 'none', why: 'choose an input' });
  });

  it('toggles: blank, panic, overlays', () => {
    expect(body(request('blank', {}, state(), 'live'))).toEqual({ type: 'setBlank', screens: ['live'], value: true });
    expect(body(request('blank', {}, state(), 'back'))).toEqual({ type: 'setBlank', screens: ['back'], value: false });
    expect(body(request('blank', { mode: 'ftb' }, state(), 'live'))).toEqual({ type: 'fadeToBlack', screen: 'live' });
    expect(body(request('panic', {}, state(), 'live'))).toEqual({ type: 'panic', value: true });
    expect(body(request('overlay', { channel: '1' }, state(), 'live'))).toEqual({ type: 'setOverlayOn', channel: 0, value: false });
    expect(body(request('overlay', { channel: '3' }, state(), 'live'))).toEqual({ type: 'setOverlayOn', channel: 2, value: true });
    expect(body(request('overlay', { channel: '9' }, state(), 'live'))).toEqual({ type: 'setOverlayOn', channel: 0, value: false });
  });

  it('the backup lineup: on and off (on unless the event turned it off)', () => {
    const on = { ...sampleShow(), event: { backup: { on: true } } };
    const off = { ...sampleShow(), event: { backup: { on: false } } };
    expect(state({}, on).backup).toBe(true);
    expect(state({}, sampleShow()).backup).toBe(false);
    expect(body(request('backup', {}, state({}, on), 'live'))).toEqual({ type: 'setBackupOn', value: false });
    expect(body(request('backup', {}, state({}, off), 'live'))).toEqual({ type: 'setBackupOn', value: true });
    expect(kindOf(uuid('backup'))).toBe('backup');
  });

  it('presets, cues and countdowns', () => {
    expect(body(request('preset', { preset: 'p1' }, state(), 'live'))).toEqual({ type: 'pickPreset', id: 'p1' });
    expect(body(request('preset', { preset: 'gone', presetName: 'Speeches' }, state(), 'live'))).toEqual({ type: 'pickPreset', id: 'p2' });
    expect(body(request('preset', { preset: 'next' }, state(), 'live'))).toEqual({ type: 'nextPreset' });
    expect(body(request('nextcue', {}, state(), 'live'))).toEqual({ type: 'nextCue' });
    expect(body(request('countdown', {}, state(), 'live'))).toEqual({ type: 'startCountdown', id: 'cd' });
    expect(body(request('countdown', { mode: 'reset' }, state(), 'live'))).toEqual({ type: 'resetCountdown', id: 'cd' });
    expect(request('countdown', { countdown: 'missing' }, state(), 'live').to).toBe('none');
  });

  it('recording, going live, rehearsal and replay go to the control window', () => {
    expect(request('record', {}, state(), 'live')).toEqual({ to: 'app', body: { command: 'record', on: true } });
    expect(body(request('record', {}, state({ recording: true }), 'live'))).toEqual({ command: 'record', on: false });
    expect(body(request('golive', {}, state(), 'live'))).toEqual({ command: 'stream', on: true });
    expect(body(request('golive', {}, state({ streaming: true }), 'live'))).toEqual({ command: 'stream', on: false });
    expect(body(request('rehearsal', {}, state(), 'live'))).toEqual({ command: 'rehearsal', on: true });
    expect(request('rehearsal', {}, state({ streaming: true }), 'live').to).toBe('none');
    expect(body(request('replay', {}, state(), 'live'))).toEqual({ command: 'replayBuffer', on: true });
    expect(body(request('replay', { seconds: '20', slow: true }, state({ replay: true }), 'live'))).toEqual({ command: 'replay', seconds: 20, slow: true });
  });

  it('the Screen key switches the deck between Live and Back without asking Lumora', () => {
    expect(request('screen', {}, null, 'live')).toEqual({ to: 'screen', screen: 'back' });
    expect(request('screen', {}, null, 'back')).toEqual({ to: 'screen', screen: 'live' });
    expect(request('take', {}, null, 'live')).toEqual({ to: 'none', why: 'offline' });
  });
});

describe('holding', () => {
  it('PANIC and going live always need a hold; stopping a recording does unless switched off', () => {
    expect(needsHold('panic', {}, state())).toBe(true);
    expect(needsHold('golive', {}, state())).toBe(true);
    expect(needsHold('record', {}, state())).toBe(false);
    expect(needsHold('record', {}, state({ recording: true }))).toBe(true);
    expect(needsHold('record', { holdToStop: false }, state({ recording: true }))).toBe(false);
    expect(needsHold('take', {}, state())).toBe(false);
  });
});

describe('action ids', () => {
  it('go both ways', () => {
    expect(uuid('golive')).toBe('com.lumora.streamdeck.golive');
    expect(kindOf('com.lumora.streamdeck.golive')).toBe('golive');
    expect(kindOf('com.other.take')).toBeNull();
  });
});
