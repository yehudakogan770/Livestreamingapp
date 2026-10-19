
test('marks go into the event file straight away, in order, and only while recording', async () => {
  const { Broadcaster } = await import('./recorder');
  const client = new DemoClient();
  const saved = vi.spyOn(client, 'saveEventFile');
  const b = new Broadcaster(client, sound().engine as never);
  expect(b.mark('Too early')).toBeNull();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  await b.start('record', settings, 'Gala');
  now.mockReturnValue(61_000);
  expect(b.mark('')).toBe(1);
  expect(b.mark('  Speech   starts  ', 20_000)).toBe(2);
  expect(b.marks()).toBe(2);
  const last = JSON.parse(saved.mock.calls.at(-1)![1]) as { markers: { at: number; name: string }[] };
  expect(last.markers).toEqual([
    { at: 40_000, name: 'Speech starts' },
    { at: 60_000, name: 'Mark 1' },
  ]);
  await b.stop('record');
  expect(b.marks()).toBe(0);
  expect(b.mark('After')).toBeNull();
});
