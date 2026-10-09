import { describe, expect, it, vi } from 'vitest';
import { newChatHub, parseTwitch, twitchChannel, youtubeVideoId, type FacebookComments } from './chat';

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

describe('Facebook comments', () => {
  it('waits until the live video is on, then reads new comments from where it left off', async () => {
    const hub = newChatHub();
    const asked: string[] = [];
    const answers: (() => Promise<FacebookComments>)[] = [
      () => Promise.reject(new Error('Facebook comments come in once you go live on Facebook through a connected account.')),
      () => Promise.resolve({ comments: [{ id: '1', author: 'Ana', text: 'Hello' }], after: 'A' }),
      () =>
        Promise.resolve({
          comments: [
            { id: '1', author: 'Ana', text: 'Hello' },
            { id: '2', author: 'Ben', text: 'Great show' },
          ],
          after: 'B',
        }),
    ];
    hub.connectFacebook((after) => {
      asked.push(after);
      return (answers.shift() ?? (() => Promise.resolve({ comments: [], after })))();
    }, 1);
    const seen: string[] = [];
    hub.subscribe(() => seen.push(`${hub.state.facebook.status}: ${hub.state.facebook.problem ?? ''}`));
    await vi.waitFor(() => expect(hub.state.messages).toHaveLength(2));
    expect(hub.state.facebook).toEqual({ status: 'on', problem: null });
    expect(hub.state.messages.map((m) => [m.platform, m.author, m.text])).toEqual([
      ['facebook', 'Ana', 'Hello'],
      ['facebook', 'Ben', 'Great show'],
    ]);
    expect(asked.slice(0, 4)).toEqual(['', '', 'A', 'B']);
    // Before the stream was on, it said why and kept asking.
    expect(seen[0]).toMatch(/^connecting: .*go live on Facebook/);
    hub.disconnectFacebook();
    expect(hub.state.facebook.status).toBe('off');
  });

  it('outside the app, says where it works', () => {
    const hub = newChatHub();
    hub.connectFacebook(null);
    expect(hub.state.facebook.status).toBe('error');
    expect(hub.state.facebook.problem).toMatch(/Lumora app/);
  });
});
