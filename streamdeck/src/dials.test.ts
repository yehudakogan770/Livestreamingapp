import { describe, expect, it, vi } from 'vitest';
import { dialFeedback, dialPush, dialRotate, dialTouch, faderTarget, stepOf } from './dials';
import { deckState } from './show';
import { Deck } from './deck';
import { request } from './actions';
import { keyModel } from './keys';
import type { LumoraClient } from './protocol';

const show = {
  sources: [
    { id: 'mic', name: 'Host mic', kind: { type: 'audio' }, volume: 0.5, muted: false },
    { id: 'cam', name: 'Camera 1', kind: { type: 'camera' }, volume: 1, muted: true },
  ],
  screens: { live: { program: 'cam', preview: 'mic', tbar: 0.3 }, back: { tbar: 0 } },
  masterVolume: 0.8,
  audio: { masterMuted: false, a: { volume: 0.6, muted: true }, b: { volume: 1, muted: false } },
};
const state = deckState(show);

describe('Stream Deck + dials', () => {
  it('reads the levels and the T-bar from the show', () => {
    expect(state.audio.master).toEqual({ volume: 0.8, muted: false });
    expect(state.audio.a).toEqual({ volume: 0.6, muted: true });
    expect(state.screens.live.tbar).toBe(0.3);
    expect(state.inputs[0]).toMatchObject({ volume: 0.5, muted: false });
  });

  it('turns the master, a mix or one input', () => {
    expect(dialRotate('fader', {}, state, 'live', 3).request).toEqual({ to: 'action', body: { type: 'setMasterVolume', value: 0.86 } });
    expect(dialRotate('fader', { target: 'a' }, state, 'live', -1).request).toEqual({
      to: 'action',
      body: { type: 'updateBus', bus: 'a', patch: { volume: 0.58 } },
    });
    expect(dialRotate('fader', { target: 'mic', step: '5' }, state, 'live', 2).request).toEqual({
      to: 'action',
      body: { type: 'updateSource', id: 'mic', patch: { volume: 0.6 } },
    });
    expect(dialRotate('fader', {}, state, 'live', 50).value).toBe(1);
    expect(dialRotate('fader', { target: 'gone' }, state, 'live', 1).request.to).toBe('none');
  });

  it('finds an input again by its name', () => {
    expect(faderTarget(state, { target: 'old-id', targetName: 'Host mic' })).toMatchObject({ kind: 'input', id: 'mic' });
  });

  it('pushing mutes and unmutes', () => {
    expect(dialPush('fader', {}, state, 'live')).toEqual({ to: 'action', body: { type: 'setMasterMuted', value: true } });
    expect(dialPush('fader', { target: 'cam' }, state, 'live')).toEqual({ to: 'action', body: { type: 'updateSource', id: 'cam', patch: { muted: false } } });
    expect(dialTouch('fader', { target: 'b' }, state, 'live')).toEqual({ to: 'action', body: { type: 'updateBus', bus: 'b', patch: { muted: true } } });
  });

  it('the T-bar mixes, completes the take at the end, and push / touch take or cut', () => {
    expect(dialRotate('tbar', {}, state, 'live', 2).request).toEqual({ to: 'action', body: { type: 'setTbar', screen: 'live', value: 0.38 } });
    const end = dialRotate('tbar', {}, state, 'live', 40);
    expect(end.request).toEqual({ to: 'action', body: { type: 'setTbar', screen: 'live', value: 1 } });
    expect(end.value).toBe(0);
    expect(dialRotate('tbar', { screen: 'back' }, state, 'live', 1).request).toMatchObject({ body: { screen: 'back', value: 0.04 } });
    expect(dialPush('tbar', {}, state, 'back')).toEqual({ to: 'action', body: { type: 'take', screen: 'back' } });
    expect(dialTouch('tbar', {}, state, 'live')).toEqual({ to: 'action', body: { type: 'take', screen: 'live', transition: 'cut' } });
    expect(stepOf({}, 'tbar')).toBe(0.04);
  });

  it('a Mute key mutes what it controls, and turns red while muted', () => {
    expect(request('mute', { target: 'cam' }, state, 'live')).toEqual({ to: 'action', body: { type: 'updateSource', id: 'cam', patch: { muted: false } } });
    expect(request('mute', {}, state, 'live')).toEqual({ to: 'action', body: { type: 'setMasterMuted', value: true } });
    expect(keyModel('mute', { target: 'cam' }, { state, connection: 'online', deck: 'live', now: 0 })).toMatchObject({
      label: 'Camera 1',
      sub: 'Muted',
      tone: 'program',
    });
    expect(keyModel('mute', { target: 'mic' }, { state, connection: 'online', deck: 'live', now: 0 })).toMatchObject({ sub: '50%', tone: 'idle' });
  });

  it('the strip shows the level, Muted, or why not', () => {
    expect(dialFeedback('fader', {}, state, 'live', 'online')).toEqual({ title: 'Stream', value: '80%', indicator: 80 });
    expect(dialFeedback('fader', { target: 'a' }, state, 'live', 'online')).toEqual({ title: 'Mix A', value: 'Muted', indicator: 0 });
    expect(dialFeedback('tbar', {}, state, 'live', 'online', 0.5)).toEqual({ title: 'T-bar · Live', value: '50%', indicator: 50 });
    expect(dialFeedback('tbar', {}, null, 'live', 'wrongPin').value).toBe('Wrong PIN');
  });

  it('turning quickly builds on the value just sent, not Lumora’s older one', async () => {
    const action = vi.fn(async () => ({ ok: true }));
    const client = { state, connection: 'online', subscribe: () => () => {}, now: () => 0, action, command: vi.fn() } as unknown as LumoraClient;
    let t = 1000;
    const timers = { set: () => 0, clear: () => {}, now: () => t };
    const feedback = vi.fn();
    const deck = new Deck(client, { setImage: () => {}, showAlert: () => {}, showOk: () => {}, saveGlobal: () => {}, setFeedback: feedback }, timers);
    deck.dialAppear('d1', 'fader', {});
    expect(feedback).toHaveBeenLastCalledWith('d1', { title: 'Stream', value: '80%', indicator: 80 });
    await deck.dialRotate('d1', 1);
    await deck.dialRotate('d1', 1);
    expect(action).toHaveBeenLastCalledWith({ type: 'setMasterVolume', value: 0.84 });
    expect(feedback).toHaveBeenLastCalledWith('d1', { title: 'Stream', value: '84%', indicator: 84 });
    t += 5000;
    await deck.dialRotate('d1', 1);
    expect(action).toHaveBeenLastCalledWith({ type: 'setMasterVolume', value: 0.82 });
    await deck.dialPush('d1');
    expect(action).toHaveBeenLastCalledWith({ type: 'setMasterMuted', value: true });
  });
});
