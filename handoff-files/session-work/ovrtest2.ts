
test('slides leave their background (and a camera behind) to the engine: only the slides are in the plane', async () => {
  const { client, show } = await setup();
  await client.dispatch({
    type: 'addSource',
    source: {
      id: 'sl',
      name: 'Slides',
      kind: {
        type: 'slideshow',
        slides: [],
        current: 0,
        changedAt: 0,
        autoMs: null,
        looping: true,
        area: { x: 0, y: 0, w: 100, h: 100 },
        fit: 'contain',
        background: '#2040ff',
        behind: 'cam',
        fade: true,
        black: false,
      },
    },
  });
  await client.dispatch({ type: 'cutTo', screen: 'live', sourceId: 'sl' });
  const r = new OverlayRenderer(client, 'live', 160, 90, 60, () => Promise.resolve());
  r.setShow(await show());
  // A clean start, and no pixels: the blue background and the camera are the engine's.
  expect(read(r.frame(10_000)!).map((x) => x.op)).toEqual([3]);
  expect(gum).not.toHaveBeenCalled();
  r.dispose();
});
