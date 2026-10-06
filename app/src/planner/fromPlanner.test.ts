import { describe, expect, it } from 'vitest';
import { blankCue, type PlanCue } from '../../../planner/src/model';
import type { Cue } from '../engine/types/Cue';
import type { Show } from '../engine/types/Show';
import { combine, cueSteps, DEFAULT_OPTIONS, matchTransition, MAX_CUES, planToCues } from './fromPlanner';

const src = (id: string, name: string, type: string) => ({ id, name, kind: { type } });
const show = {
  sources: [
    src('cam1', 'Camera 1', 'camera'),
    src('vid', 'Opening Video', 'video'),
    src('cd', 'Doors countdown', 'countdown'),
    src('lt', 'Lower third', 'text'),
  ],
  overlays: [
    { sourceId: 'lt', screens: ['live'] },
    { sourceId: null, screens: ['live'] },
  ],
  presets: [{ id: 'p1', name: 'Wide + logo' }],
} as unknown as Pick<Show, 'sources' | 'overlays' | 'presets'>;

const cue = (id: string, position: number, more: Partial<PlanCue> = {}): PlanCue => ({ ...blankCue('plan', id, position), ...more });

describe('transitions', () => {
  it('matches what people write', () => {
    expect(matchTransition('Fade')).toBe('fade');
    expect(matchTransition('wipe left')).toBe('wipeLeft');
    expect(matchTransition('Stinger 2')).toBe('stinger2');
    expect(matchTransition('Luma heart')).toBe('lumaHeart');
    expect(matchTransition('dissolve')).toBe('fade');
    expect(matchTransition('swoosh')).toBeNull();
    expect(matchTransition('')).toBeNull();
  });
});

describe('steps from hints', () => {
  it('cuts to the named input', () => {
    const r = cueSteps(cue('a', 1, { input: 'camera 1' }), show, DEFAULT_OPTIONS);
    expect(r.steps).toEqual([{ type: 'cutTo', screen: 'live', sourceId: 'cam1' }]);
    expect(r.unmapped).toEqual([]);
  });

  it('uses a transition: into Next, then TAKE', () => {
    const r = cueSteps(cue('a', 1, { input: 'Camera 1', transition: 'Dip' }), show, DEFAULT_OPTIONS);
    expect(r.steps).toEqual([
      { type: 'preview', screen: 'live', sourceId: 'cam1' },
      { type: 'take', screen: 'live', transition: 'dip' },
    ]);
  });

  it('plays a video cue', () => {
    const r = cueSteps(cue('a', 1, { segment: 'video', input: 'Opening video' }), show, DEFAULT_OPTIONS);
    expect(r.steps).toEqual([
      { type: 'cutTo', screen: 'live', sourceId: 'vid' },
      { type: 'play', sourceId: 'vid' },
    ]);
  });

  it('sets and starts the countdown (the event’s, when none is named)', () => {
    const r = cueSteps(cue('a', 1, { segment: 'countdown', durationSec: 600 }), show, DEFAULT_OPTIONS);
    expect(r.steps).toEqual([
      { type: 'setCountdownLength', sourceId: 'cd', lengthMs: 600_000 },
      { type: 'cutTo', screen: 'live', sourceId: 'cd' },
      { type: 'startCountdown', sourceId: 'cd' },
    ]);
  });

  it('shows an overlay by its input’s name, its number, or a preset', () => {
    expect(cueSteps(cue('a', 1, { overlay: 'Lower Third' }), show, DEFAULT_OPTIONS).steps).toEqual([{ type: 'overlay', channel: 0, value: true }]);
    expect(cueSteps(cue('a', 1, { overlay: 'Overlay 2' }), show, DEFAULT_OPTIONS).steps).toEqual([{ type: 'overlay', channel: 1, value: true }]);
    expect(cueSteps(cue('a', 1, { overlay: 'wide + logo' }), show, DEFAULT_OPTIONS).steps).toEqual([{ type: 'preset', presetId: 'p1' }]);
  });

  it('lists hints that match nothing, and makes no steps for them', () => {
    const r = cueSteps(cue('a', 1, { input: 'Drone', overlay: 'Sponsor bug', transition: 'swoosh' }), show, DEFAULT_OPTIONS);
    expect(r.steps).toEqual([]);
    expect(r.unmapped).toEqual(['transition “swoosh”', 'input “Drone”', 'overlay “Sponsor bug”']);
  });

  it('puts notes on the Monitor only when asked', () => {
    const c = cue('a', 1, { notes: 'Wait for the\nrabbi to sit' });
    expect(cueSteps(c, show, DEFAULT_OPTIONS).steps).toEqual([]);
    expect(cueSteps(c, show, { ...DEFAULT_OPTIONS, notesToMonitor: true }).steps).toEqual([{ type: 'monitorMessage', text: 'Wait for the rabbi to sit' }]);
  });
});

describe('plan → Lumora cues', () => {
  const planned = [
    cue('c3', 3000, { title: 'Speech', segment: 'speaker', who: 'Rabbi Kogan', durationSec: 900, section: 'Program' }),
    cue('c1', 1000, { title: 'Doors', segment: 'countdown', durationSec: 600, section: 'Opening' }),
    cue('c2', 2000, { title: '', segment: 'video', input: 'Opening Video', durationSec: 90, section: 'Opening' }),
    cue('c4', 4000, { title: 'Closing', startTime: '20:30' }),
  ];

  it('keeps the plan’s order, names, sections and lengths; unmapped cues are note cues', () => {
    const { cues, report } = planToCues({ startTime: '19:00' }, planned, show);
    expect(cues.map((c) => c.name)).toEqual(['Doors', 'Video', 'Speech', 'Closing']);
    expect(cues.map((c) => c.section)).toEqual(['Opening', 'Opening', 'Program', '']);
    expect(cues.map((c) => c.lengthMs)).toEqual([600_000, 90_000, 900_000, null]);
    expect(cues.map((c) => c.id)).toEqual(['planner-c1', 'planner-c2', 'planner-c3', 'planner-c4']);
    expect(cues[2]!.steps).toEqual([]);
    expect(report[2]!.mapped).toEqual([]);
    expect(cues.every((c) => c.trigger.type === 'manual')).toBe(true);
  });

  it('runs as planned: the start and fixed times on the clock, the rest after the cue before', () => {
    const { cues } = planToCues({ startTime: '19:00' }, planned, show, { ...DEFAULT_OPTIONS, timing: 'planned' });
    expect(cues.map((c) => c.trigger)).toEqual([
      { type: 'clock', time: '19:00' },
      { type: 'afterPrevious' },
      { type: 'afterPrevious' },
      { type: 'clock', time: '20:30' },
    ]);
  });

  it('waits for NEXT CUE after a cue with no length', () => {
    const { cues } = planToCues({ startTime: '' }, [cue('a', 1), cue('b', 2)], show, { ...DEFAULT_OPTIONS, timing: 'planned' });
    expect(cues.map((c) => c.trigger.type)).toEqual(['manual', 'manual']);
  });

  it('adds who is responsible, and keeps names within 80 characters', () => {
    const { cues } = planToCues({ startTime: '' }, [cue('a', 1, { title: 'x'.repeat(90), who: 'Dana' }), cue('b', 2, { title: 'Hi', who: 'Eli' })], show, {
      ...DEFAULT_OPTIONS,
      whoInName: true,
    });
    expect(cues[0]!.name).toHaveLength(80);
    expect(cues[1]!.name).toBe('Hi · Eli');
  });

  it('replaces the run of show, or adds after it (with fresh ids for a second copy)', () => {
    const current: Cue[] = [{ id: 'mine', section: '', name: 'Mine', trigger: { type: 'manual' }, lengthMs: null, steps: [] }];
    const { cues } = planToCues({ startTime: '' }, planned, show);
    expect(combine(current, cues, 'replace').map((c) => c.id)).toEqual(cues.map((c) => c.id));
    const added = combine(current, cues, 'append');
    expect(added.map((c) => c.name)).toEqual(['Mine', 'Doors', 'Video', 'Speech', 'Closing']);
    const twice = combine(added, cues, 'append');
    expect(new Set(twice.map((c) => c.id)).size).toBe(twice.length);
    const many = Array.from({ length: MAX_CUES }, (_, i) => ({ ...current[0]!, id: `m${i}` }));
    expect(combine(many, cues, 'append')).toHaveLength(MAX_CUES);
  });
});
