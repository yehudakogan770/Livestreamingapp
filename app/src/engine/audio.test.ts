import { describe, expect, it } from 'vitest';
import { channelLevel, faderToGain, mixSend, onAirAmount, soundSources } from './audio';
import { demoApply } from './demo';
import { emptyShow } from './client';
import type { Action } from './types/Action';
import type { Show } from './types/Show';

const setup = (): Show =>
  (
    [
      { type: 'addSource', source: { id: 'a', name: 'Clip A', kind: { type: 'video', path: 'a.mp4', durationS: 10, playback: { playing: false, posS: 0, at: 0 } } } },
      { type: 'addSource', source: { id: 'b', name: 'Clip B', kind: { type: 'video', path: 'b.mp4', durationS: 10, playback: { playing: false, posS: 0, at: 0 } } } },
      { type: 'addSource', source: { id: 'mic', name: 'Mic', kind: { type: 'microphone', deviceId: 'm', label: 'Mic' } } },
      { type: 'addSource', source: { id: 'red', name: 'Red', kind: { type: 'color', color: '#ff0000' } } },
      { type: 'cutTo', screen: 'live', sourceId: 'a' },
    ] satisfies Action[]
  ).reduce((s, a) => demoApply(s, a, 0), emptyShow());

describe('which inputs have sound', () => {
  it('videos and microphones get a mixer channel; pictures and colours do not', () => {
    expect(soundSources(setup()).map((s) => s.id)).toEqual(['a', 'b', 'mic']);
  });
});

describe('audio follows video', () => {
  it('only the input on air on the Live Screen is heard', () => {
    const s = setup();
    expect(onAirAmount(s, 'a', 5000)).toBe(1);
    expect(onAirAmount(s, 'b', 5000)).toBe(0);
  });

  it('sound crossfades with a TAKE', () => {
    let s = demoApply(setup(), { type: 'setPreview', screen: 'live', sourceId: 'b' }, 1000);
    s = demoApply(s, { type: 'take', screen: 'live' }, 1000); // 800 ms fade
    expect(onAirAmount(s, 'b', 1400)).toBeCloseTo(0.5);
    expect(onAirAmount(s, 'a', 1400)).toBeCloseTo(0.5);
    expect(onAirAmount(s, 'a', 2000)).toBe(0);
  });

  it('a dip goes through silence', () => {
    let s = demoApply(setup(), { type: 'setTransition', kind: 'dip' }, 0);
    s = demoApply(s, { type: 'setPreview', screen: 'live', sourceId: 'b' }, 1000);
    s = demoApply(s, { type: 'take', screen: 'live' }, 1000);
    expect(onAirAmount(s, 'a', 1400) + onAirAmount(s, 'b', 1400)).toBeCloseTo(0);
  });

  it('the T-bar mixes the sound too', () => {
    let s = demoApply(setup(), { type: 'setPreview', screen: 'live', sourceId: 'b' }, 0);
    s = demoApply(s, { type: 'setTbar', screen: 'live', value: 0.25 }, 0);
    expect(onAirAmount(s, 'b', 100)).toBe(0.25);
    expect(onAirAmount(s, 'a', 100)).toBe(0.75);
  });
});

describe('channel levels', () => {
  it('microphones are always live; blanking the Live Screen fades only the picture sound', () => {
    let s = setup();
    expect(channelLevel(s, s.sources[2]!, 5000)).toBe(1);
    s = demoApply(s, { type: 'setBlank', screens: ['live'], value: true }, 5000);
    expect(channelLevel(s, s.sources[0]!, 6000)).toBe(0);
    expect(channelLevel(s, s.sources[2]!, 6000)).toBe(1);
  });

  it('faders follow a natural curve and mute wins', () => {
    let s = demoApply(setup(), { type: 'updateSource', id: 'mic', patch: { volume: 0.5 } }, 0);
    expect(channelLevel(s, s.sources[2]!, 0)).toBeCloseTo(faderToGain(0.5));
    s = demoApply(s, { type: 'updateSource', id: 'mic', patch: { muted: true } }, 0);
    expect(channelLevel(s, s.sources[2]!, 0)).toBe(0);
  });

  it('each input only reaches the mixes it is sent to', () => {
    let s = demoApply(setup(), { type: 'updateSource', id: 'mic', patch: { audio: { toA: false } } }, 0);
    s = demoApply(s, { type: 'updateBus', bus: 'b', patch: { muted: true } }, 0);
    const mic = s.sources[2]!;
    expect(mixSend(s, mic, 'master')).toBe(1);
    expect(mixSend(s, mic, 'a')).toBe(0);
    expect(mixSend(s, mic, 'b')).toBe(0);
  });

  it('a microphone can never be put on a screen', () => {
    expect(() => demoApply(setup(), { type: 'setPreview', screen: 'live', sourceId: 'mic' }, 0)).toThrow();
  });
});
