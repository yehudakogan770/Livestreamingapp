
describe('Facebook comments', () => {
  it('waits until the live video is on, then reads new comments from where it left off', async () => {
    const hub = newChatHub();
    const asked: string[] = [];
    const answers: (() => Promise<FacebookComments>)[] = [
      () => Promise.reject(new Error('Facebook comments come in once you go live on Facebook through a connected account.')),
      () => Promise.resolve({ comments: [{ id: '1', author: 'Ana', text: 'Hello' }], after: 'A' }),
      () => Promise.resolve({ comments: [{ id: '1', author: 'Ana', text: 'Hello' }, { id: '2', author: 'Ben', text: 'Great show' }], after: 'B' }),
    ];
    hub.connectFacebook((after) => {
      asked.push(after);
      return (answers.shift() ?? (() => Promise.resolve({ comments: [], after })))();
    }, 1);
    await vi.waitFor(() => expect(hub.state.facebook.problem).toMatch(/go live on Facebook/));
    expect(hub.state.facebook.status).toBe('connecting');
    await vi.waitFor(() => expect(hub.state.messages).toHaveLength(2));
    expect(hub.state.facebook).toEqual({ status: 'on', problem: null });
    expect(hub.state.messages.map((m) => [m.platform, m.author, m.text])).toEqual([
      ['facebook', 'Ana', 'Hello'],
      ['facebook', 'Ben', 'Great show'],
    ]);
    expect(asked.slice(0, 4)).toEqual(['', '', 'A', 'B']);
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
