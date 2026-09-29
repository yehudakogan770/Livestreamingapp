import { describe, expect, it } from 'vitest';
import { parseTwitch, twitchChannel, youtubeVideoId } from './chat';

describe('live chat', () => {
  it('reads Twitch chat lines', () => {
    const m = parseTwitch('@badge-info=;color=#FF0000;display-name=Ana\\sB;id=abc-1;mod=0 :ana!ana@ana.tmi.twitch.tv PRIVMSG #show :Mazel tov!');
    expect(m).toEqual({ id: 'abc-1', author: 'Ana B', text: 'Mazel tov!', color: '#FF0000' });
    expect(parseTwitch(':ana!ana@ana.tmi.twitch.tv PRIVMSG #show :\u0001ACTION waves\u0001')?.text).toBe('waves');
    expect(parseTwitch('PING :tmi.twitch.tv')).toBeNull();
    expect(parseTwitch(':tmi.twitch.tv 001 justinfan1 :Welcome')).toBeNull();
  });

  it('finds the video and channel in addresses', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ?si=x')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('hello')).toBeNull();
    expect(twitchChannel('https://www.twitch.tv/SomeChannel')).toBe('somechannel');
    expect(twitchChannel('some channel')).toBeNull();
  });
});
