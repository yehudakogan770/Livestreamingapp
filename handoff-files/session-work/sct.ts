
describe('the speaker’s countdown, as the stage Monitor shows it', () => {
  const timing = { wrapUpS: 120, overtime: true };
  const cd = { endsAt: 600_000, remainingMs: 600_000 };
  it('turns amber, then red, then counts the time over', () => {
    expect(stageTime(cd, timing, 0)).toEqual({ tone: 'normal', text: '10:00' });
    expect(stageTime(cd, timing, 480_000)).toEqual({ tone: 'wrapUp', text: '2:00' });
    expect(stageTime(cd, timing, 545_000)).toEqual({ tone: 'urgent', text: '0:55' });
    expect(stageTime(cd, timing, 665_000)).toEqual({ tone: 'over', text: '+1:05' });
    expect(stageTime({ ...cd, endText: 'Thank you' }, timing, 665_000)).toEqual({ tone: 'urgent', text: 'Thank you' });
    expect(stageTime(cd, { wrapUpS: 0, overtime: false }, 665_000)).toEqual({ tone: 'urgent', text: '0:00' });
    expect(stageTime(cd, undefined, 480_000).tone).toBe('wrapUp');
    expect(stageTime({ endsAt: null, remainingMs: 90_000 }, timing, 0)).toEqual({ tone: 'paused', text: '1:30' });
  });
});
