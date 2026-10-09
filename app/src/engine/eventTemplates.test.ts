import { describe, expect, it } from 'vitest';
import { DemoClient } from './client';
import { demoApply } from './demo';
import { TEMPLATES, templateActions } from './eventTemplates';
import type { Show } from './types/Show';

const fresh = async (): Promise<Show> => (await new DemoClient().getShow()).show;

describe('event templates', () => {
  it('each one sets up a working show: its inputs, eight monitor messages and a run of show', async () => {
    for (const t of TEMPLATES) {
      let s = await fresh();
      const before = s.sources.length;
      for (const a of templateActions(t.id, s, 'x')) s = demoApply(s, a, 0);
      expect(s.sources.length - before, t.id).toBeGreaterThanOrEqual(4);
      expect(s.monitor.quick, t.id).toHaveLength(8);
      expect(
        s.monitor.quick.every((q) => q.trim() !== ''),
        t.id,
      ).toBe(true);
      expect(s.run.cues.length, t.id).toBeGreaterThanOrEqual(5);
      expect(t.adds.length, t.id).toBeGreaterThan(0);
    }
  });

  it('never replaces a run of show already written, and ids never clash', async () => {
    let s = await fresh();
    s = demoApply(s, { type: 'setCues', cues: [{ id: 'mine', section: '', name: 'My cue', trigger: { type: 'manual' }, lengthMs: null, steps: [] }] }, 0);
    for (const a of templateActions('sports', s, 'a')) s = demoApply(s, a, 0);
    for (const a of templateActions('sports', s, 'b')) s = demoApply(s, a, 0);
    expect(s.run.cues.map((c) => c.id)).toEqual(['mine']);
    expect(new Set(s.sources.map((x) => x.id)).size).toBe(s.sources.length);
    expect(s.sources.filter((x) => x.kind.type === 'scoreboard')).toHaveLength(2);
  });

  it('the webinar starts its countdown when the stream starts', async () => {
    let s = await fresh();
    for (const a of templateActions('webinar', s, 'w')) s = demoApply(s, a, 0);
    const t = s.triggers.at(-1)!;
    expect(t.when).toEqual({ type: 'broadcast', what: 'stream', on: true });
    const cd = s.sources.find((x) => x.kind.type === 'countdown')!;
    expect(t.steps).toEqual([
      { type: 'cutTo', screen: 'live', sourceId: cd.id },
      { type: 'startCountdown', sourceId: cd.id },
    ]);
    s = demoApply(s, { type: 'fireTrigger', id: t.id }, 1000);
    expect(s.screens.live.program).toBe(cd.id);
  });

  it('uses no religious wording', () => {
    const words = JSON.stringify(TEMPLATES.map((t) => templateActions(t.id, { run: { cues: [] }, triggers: [] } as unknown as Show, 'z')));
    expect(words).not.toMatch(/worship|church|prayer|sermon|synagogue|mass\b|blessing/i);
  });
});
