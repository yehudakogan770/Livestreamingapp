
test('the person finding the engine asked for is in the report', () => {
  let m = noteEngine(null, stats({}));
  expect(engineRows(m).some((r) => r[0]!.includes('person finding'))).toBe(false);
  m = noteEngine(m, stats({ vision: { inputs: 1, frames: 90, answers: 88, masks: 1 } }));
  m = noteEngine(m, stats({ vision: { inputs: 0, frames: 120, answers: 118, masks: 0 } }));
  expect(m.vision).toEqual({ frames: 120, answers: 118, masks: 1 });
  expect(engineRows(m).find((r) => r[0]!.includes('person finding'))![1]).toBe('120 frames to the models, 118 answers, up to 1 with a person mask');
});
