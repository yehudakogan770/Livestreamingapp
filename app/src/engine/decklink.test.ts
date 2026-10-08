import { describe, expect, it } from 'vitest';
import { audioPairs, cardUrl, isCardUrl, parseCardUrl, signalFor, signalLine, type CardSignal } from './decklink';
import { cleanStreamUrl, streamName } from './stream';

const live: CardSignal = {
  url: 'decklink://DeckLink Duo (1)?input=sdi',
  device: 'DeckLink Duo (1)',
  state: 'live',
  mode: '1080i59.94',
  width: 1920,
  height: 1080,
  fps: 29.97,
  pixels: '8-bit YUV',
  channels: 16,
  timecode: '10:00:03:12',
  frames: 120,
};

describe('capture card addresses', () => {
  it('are written and read as the app writes them', () => {
    const url = cardUrl({ device: 'DeckLink Duo (1)', connection: 'sdi', audioPair: 1 });
    expect(url).toBe('decklink://DeckLink Duo (1)?input=sdi&audio=3-4');
    expect(parseCardUrl(url)).toEqual({ device: 'DeckLink Duo (1)', connection: 'sdi', audioPair: 1 });
    expect(cardUrl({ device: 'Intensity Pro 4K', connection: null, audioPair: 0 })).toBe('decklink://Intensity Pro 4K');
    expect(parseCardUrl('decklink://x?input=optical&audio=15-16')).toEqual({ device: 'x', connection: 'opticalSdi', audioPair: 7 });
    expect(parseCardUrl('decklink://')).toBeNull();
    expect(parseCardUrl('ndi://PC (Cam)')).toBeNull();
    expect(isCardUrl(' DeckLink://x')).toBe(true);
  });

  it('are stream addresses with spaces allowed, named after the card', () => {
    expect(cleanStreamUrl('decklink://DeckLink Mini Recorder 4K?input=hdmi')).toBe('decklink://DeckLink Mini Recorder 4K?input=hdmi');
    expect(cleanStreamUrl('rtsp://cam local/1')).toBeNull();
    expect(streamName('decklink://DeckLink Duo (1)?input=sdi&audio=3-4')).toBe('DeckLink Duo (1) SDI');
    expect(streamName('decklink://UltraStudio Recorder 3G')).toBe('UltraStudio Recorder 3G');
  });

  it('offer the audio pairs the card has', () => {
    expect(audioPairs(16).map((p) => p.label)).toHaveLength(8);
    expect(audioPairs(16)[1]!.label).toBe('Channels 3 and 4');
    expect(audioPairs(2)).toEqual([{ pair: 0, label: 'Channels 1 and 2' }]);
    expect(audioPairs(0)).toHaveLength(1);
  });

  it('say how the capture is doing in one line', () => {
    expect(signalLine(live)).toBe('1080i59.94 · 8-bit YUV · 16 audio channels · TC 10:00:03:12');
    expect(signalLine({ ...live, state: 'noInput' })).toMatch(/No signal/);
    expect(signalLine({ ...live, state: 'failed', detail: 'Install Desktop Video' })).toBe('Install Desktop Video');
    // The signal of an input is found whatever audio pair it hears.
    expect(signalFor([live], 'decklink://DeckLink Duo (1)?input=sdi&audio=5-6')).toBe(live);
    expect(signalFor([live], 'decklink://DeckLink Duo (1)?input=hdmi')).toBeNull();
  });
});
