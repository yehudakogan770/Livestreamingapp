
test('the Next preview’s graphics are `n:` planes at the size Next is drawn', () => {
  const s = build([...base, { type: 'setPreview', screen: 'live', sourceId: 'cd' }]);
  expect(nextPlanes(s, 'live', W / 2, H / 2).map((p) => `${p.name} ${p.w}x${p.h}`)).toEqual(['n:g:cd 960x540']);
  // A camera lined up: nothing (the engine draws it); nothing lined up on the Back Screen.
  const c = build([...base, { type: 'setPreview', screen: 'live', sourceId: 'cam' }]);
  expect(nextPlanes(c, 'live', W / 2, H / 2)).toEqual([]);
  expect(nextPlanes(s, 'back', W / 2, H / 2)).toEqual([]);
});
