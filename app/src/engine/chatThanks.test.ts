import { describe, expect, it } from 'vitest';
import { parseTwitch, parseYoutube, thanksText, type ChatMessage } from './chat';
import { THANKS_MS, ThanksQueue } from './chatThanks';

describe('support from viewers in the chat', () => {
  it('reads Twitch subscriptions, raids and bits', () => {
    const sub = parseTwitch('@display-name=Ana;id=n1;msg-id=sub;system-msg=Ana\\ssubscribed\\sat\\sTier\\s1. :tmi.twitch.tv USERNOTICE #show :Love this show');
    expect(sub).toEqual({ id: 'n1', author: 'Ana', text: 'Love this show', color: undefined, badge: 'New subscriber' });
    expect(parseTwitch('@display-name=Ben;id=n2;msg-id=raid;system-msg=12\\sraiders\\sfrom\\sBen :tmi.twitch.tv USERNOTICE #show')).toMatchObject({
      badge: 'Raid',
      text: '12 raiders from Ben',
    });
    expect(parseTwitch('@id=n3;msg-id=announcement :tmi.twitch.tv USERNOTICE #show :hi')).toBeNull();
    expect(parseTwitch('@bits=100;display-name=Cy;id=c1 :cy!cy@cy.tmi.twitch.tv PRIVMSG #show :cheer100 Go team')).toMatchObject({
      badge: '100 bits',
      text: 'cheer100 Go team',
    });
    expect(parseTwitch('@display-name=Dee;id=c2 :dee!dee@dee.tmi.twitch.tv PRIVMSG #show :hello')?.badge).toBeUndefined();
  });

  it('reads YouTube Super Chats, stickers and members', () => {
    const who = { authorDetails: { displayName: 'Eve' } };
    expect(
      parseYoutube({ id: 'y1', ...who, snippet: { type: 'superChatEvent', superChatDetails: { amountDisplayString: '$5.00', userComment: 'Great!' } } }, 1),
    ).toEqual({ id: 'y1', platform: 'youtube', author: 'Eve', at: 1, text: 'Great!', badge: 'Super Chat $5.00' });
    expect(parseYoutube({ id: 'y2', ...who, snippet: { type: 'newSponsorEvent', displayMessage: 'Welcome!' } }, 1)?.badge).toBe('New member');
    expect(parseYoutube({ id: 'y3', ...who, snippet: { type: 'textMessageEvent', displayMessage: 'hi' } }, 1)).toMatchObject({ text: 'hi' });
    expect(parseYoutube({ id: 'y3', ...who, snippet: { type: 'textMessageEvent' } }, 1)).toBeNull();
  });
});

const msg = (id: string, badge?: string): ChatMessage => ({ id, platform: 'youtube', author: id, text: 'hi', at: 0, ...(badge ? { badge } : {}) });

describe('thank-yous on screen', () => {
  it('shows each new supporter for a few seconds, one after another, then takes it off', () => {
    const q = new ThanksQueue();
    const list: ChatMessage[] = [msg('old', 'Super Chat $1')];
    // What was there when it started is not thanked again.
    expect(q.step(list, 0, true)).toBeNull();
    list.push(msg('a', 'Super Chat $5'), msg('plain'), msg('b', 'New member'));
    expect(q.step(list, 100, true)).toEqual({ show: { author: 'a', text: thanksText(list[1]!), platform: 'youtube' } });
    expect(q.step(list, 100 + THANKS_MS - 1, true)).toBeNull();
    expect(q.step(list, 100 + THANKS_MS, true)?.show?.author).toBe('b');
    expect(q.step(list, 100 + 2 * THANKS_MS, true)).toEqual({ show: null });
    expect(q.step(list, 100 + 3 * THANKS_MS, true)).toBeNull();
  });

  it('does nothing while turned off, and does not catch up later', () => {
    const q = new ThanksQueue();
    const list: ChatMessage[] = [];
    q.step(list, 0, false);
    list.push(msg('a', 'Raid'));
    expect(q.step(list, 10, false)).toBeNull();
    expect(q.step(list, 20, true)).toBeNull();
    expect(thanksText({ ...msg('x', 'Raid'), text: '' })).toBe('Thank you! Raid');
  });
});
