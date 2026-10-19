
const look = { on: true, listen: null, inPicture: true, place: 'bottom' as const, size: 1, lines: 2, language: 'en', best: false };

test('captions are the Live plane `cap`, sent while there are lines and cleared after', async () => {
  const { client, show } = await setup();
  const r = new OverlayRenderer(client, 'live', 160, 90, 60, () => Promise.resolve());
  r.setShow(await show());
  r.frame(10_000);
  r.setCaptions({ lines: ['Hello there'], look });
  const on = read(r.frame(10_016)!);
  expect(on.map((x) => [x.op, x.screen, x.name, x.w, x.h])).toEqual([[1, 0, 'cap', 160, 90]]);
  // The same lines: not even drawn again.
  const before = reads.n;
  expect(r.frame(10_032)).toBeNull();
  expect(reads.n).toBe(before);
  r.setCaptions({ lines: [], look });
  expect(read(r.frame(10_048)!).map((x) => [x.op, x.name])).toEqual([[2, 'cap']]);
  // The Back Screen's renderer never writes captions.
  const b = new OverlayRenderer(client, 'back', 160, 90, 60, () => Promise.resolve());
  b.setShow(await show());
  b.setCaptions({ lines: ['Hello'], look });
  expect(read(b.frame(10_000)!).map((x) => x.op)).toEqual([3]);
  r.dispose();
  b.dispose();
});

test('the Next preview’s graphics go as half-size `n:` planes, only while they are wanted', async () => {
  const { client, show } = await setup();
  await client.dispatch({ type: 'setPreview', screen: 'live', sourceId: 'cd' });
  const r = new OverlayRenderer(client, 'live', 160, 90, 60, () => Promise.resolve());
  r.setShow(await show());
  r.frame(10_000);
  expect(r.frame(10_016)).toBeNull();
  r.setWants({ multiview: null, next: true, monitor: false });
  const on = read(r.frame(10_032)!);
  expect(on.map((x) => [x.op, x.screen, x.name, x.w, x.h])).toEqual([[1, 0, 'n:g:cd', 80, 45]]);
  r.setWants({ multiview: null, next: false, monitor: false });
  expect(read(r.frame(10_048)!).map((x) => [x.op, x.name])).toEqual([[2, 'n:g:cd']]);
  r.dispose();
});

test('the Monitor’s words go to the Monitor (screen 2) from the Live Screen’s renderer', async () => {
  const { client, show } = await setup();
  const r = new OverlayRenderer(client, 'live', 160, 90, 60, () => Promise.resolve());
  r.setWants({ multiview: null, next: false, monitor: true });
  r.setShow(await show());
  const first = read(r.frame(10_000)!);
  // A clean start for both, then the monitor's black page.
  expect(first.map((x) => [x.op, x.screen, x.name])).toEqual([
    [3, 0, ''],
    [3, 2, ''],
    [1, 2, 'mon'],
  ]);
  // Unchanged within a tenth of a second: not drawn again.
  const before = reads.n;
  expect(r.frame(10_050)).toBeNull();
  expect(reads.n).toBe(before);
  r.setWants({ multiview: null, next: false, monitor: false });
  expect(read(r.frame(10_100)!).map((x) => [x.op, x.screen, x.name])).toEqual([[2, 2, 'mon']]);
  r.dispose();
});

test('the multiview’s timecodes are small planes of their own, so the words plane is drawn once a second', async () => {
  const { client, show } = await setup();
  const r = new OverlayRenderer(client, 'live', 160, 90, 60, () => Promise.resolve());
  r.setShow(await show());
  r.setWants({
    multiview: {
      width: 192,
      height: 108,
      scale: 0.1,
      header: [0, 0, 192, 4],
      clock: [170, 0, 20, 4],
      tiles: [
        {
          content: { type: 'program', id: 'live' },
          rect: [0, 10, 96, 60],
          picture: [1, 11, 94, 55],
          label: [1, 66, 94, 3],
          tally: 'pgm',
          big: true,
          number: null,
          timecode: [80, 66, 15, 3],
        },
      ],
    },
    next: false,
    monitor: false,
  });
  const first = read(r.frame(10_000)!);
  expect(first.map((x) => x.name)).toContain('mv');
  const n = reads.n;
  r.frame(10_016);
  // The two timecodes are drawn again (they change every frame); the words are not.
  expect(reads.n - n).toBe(2);
  r.frame(11_000);
  expect(reads.n - n).toBe(5);
  r.dispose();
});

test('timecodes count frames', () => {
  const d = new Date(2026, 0, 1, 7, 3, 4, 500);
  expect(timecodeText(d, 60)).toBe('07:03:04:30');
  expect(timecodeText(new Date(2026, 0, 1, 7, 3, 4, 999), 30)).toBe('07:03:04:29');
});
