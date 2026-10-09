import { describe, expect, it } from 'vitest';
import { REARM_MS, TriggerWatch } from './triggerWatch';
import { triggersDue } from './triggers';
import { DemoClient } from './client';
import { demoApply } from './demo';
import type { Show } from './types/Show';
import type { Trigger } from './types/Trigger';
import type { When } from './types/When';

const t = (id: string, when: When, enabled = true): Trigger => ({ id, name: id, enabled, when, steps: [], lastFired: 0 });
const idle = { recording: false, streaming: false };
// Peak levels for -20 dB and -50 dB.
const loud = new Map([['mic', 0.1]]);
const quiet = new Map([['mic', 0.003]]);

describe('sound triggers', () => {
  it('go off once the sound has stayed above the level long enough, and again only after a break', () => {
    const w = new TriggerWatch();
    const list = [t('talk', { type: 'sound', sourceId: 'mic', above: true, db: -30, holdMs: 500 })];
    expect(w.feed(list, quiet, idle, 0)).toEqual([]);
    expect(w.feed(list, loud, idle, 100)).toEqual([]);
    expect(w.feed(list, loud, idle, 500)).toEqual([]);
    expect(w.feed(list, loud, idle, 600)).toEqual(['talk']);
    expect(w.feed(list, loud, idle, 2000)).toEqual([]);
    // A short pause between words doesn't set it off again.
    expect(w.feed(list, quiet, idle, 2100)).toEqual([]);
    expect(w.feed(list, loud, idle, 2200)).toEqual([]);
    expect(w.feed(list, loud, idle, 3000)).toEqual([]);
    // A real break re-arms it.
    expect(w.feed(list, quiet, idle, 3100)).toEqual([]);
    expect(w.feed(list, quiet, idle, 3100 + REARM_MS)).toEqual([]);
    expect(w.feed(list, loud, idle, 5200)).toEqual([]);
    expect(w.feed(list, loud, idle, 5700)).toEqual(['talk']);
  });

  it('can watch for quiet, and switched-off or changed triggers start afresh', () => {
    const w = new TriggerWatch();
    let list = [t('quiet', { type: 'sound', sourceId: 'mic', above: false, db: -40, holdMs: 10_000 })];
    expect(w.feed(list, quiet, idle, 0)).toEqual([]);
    expect(w.feed(list, quiet, idle, 10_000)).toEqual(['quiet']);
    // Changed: counts again from now.
    list = [t('quiet', { type: 'sound', sourceId: 'mic', above: false, db: -45, holdMs: 10_000 })];
    expect(w.feed(list, quiet, idle, 11_000)).toEqual([]);
    expect(w.feed(list, quiet, idle, 21_000)).toEqual(['quiet']);
    const off = [t('quiet2', { type: 'sound', sourceId: 'mic', above: false, db: -40, holdMs: 0 }, false)];
    expect(w.feed(off, quiet, idle, 30_000)).toEqual([]);
    // No sound known for an input counts as silence.
    expect(w.feed([t('q', { type: 'sound', sourceId: 'gone', above: false, db: -40, holdMs: 0 })], new Map(), idle, 40_000)).toEqual(['q']);
  });
});

describe('recording and streaming triggers', () => {
  it('go off on a change, not for what was already so', () => {
    const w = new TriggerWatch();
    const list = [
      t('rec on', { type: 'broadcast', what: 'record', on: true }),
      t('live on', { type: 'broadcast', what: 'stream', on: true }),
      t('live off', { type: 'broadcast', what: 'stream', on: false }),
    ];
    expect(w.feed(list, new Map(), { recording: true, streaming: false }, 0)).toEqual([]);
    expect(w.feed(list, new Map(), { recording: true, streaming: true }, 1)).toEqual(['live on']);
    expect(w.feed(list, new Map(), { recording: true, streaming: true }, 2)).toEqual([]);
    expect(w.feed(list, new Map(), { recording: false, streaming: false }, 3)).toEqual(['live off']);
    expect(w.feed(list, new Map(), { recording: true, streaming: false }, 4)).toEqual(['rec on']);
  });
});

describe('engine triggers (the browser mirror)', () => {
  async function base(): Promise<Show> {
    const c = new DemoClient();
    let s = (await c.getShow()).show;
    s = demoApply(s, { type: 'addSource', source: { id: 'cam', name: 'Cam', kind: { type: 'pattern' } } }, 0);
    s = demoApply(
      s,
      {
        type: 'addSource',
        source: { id: 'vid', name: 'Vid', kind: { type: 'video', path: '/v.mp4', durationS: 10, playback: { playing: false, posS: 0, at: 0 } } },
      },
      0,
    );
    return s;
  }

  it('a video about to end, once per play', async () => {
    let s = await base();
    s = demoApply(s, { type: 'setTriggers', triggers: [t('soon', { type: 'videoTimeLeft', sourceId: 'vid', seconds: 3 })] }, 0);
    s = demoApply(s, { type: 'play', id: 'vid' }, 1000);
    expect(triggersDue(s, s, 5000)).toEqual([]);
    expect(triggersDue(s, s, 8500)).toEqual([0]);
    s.triggers[0]!.lastFired = 8500;
    expect(triggersDue(s, s, 9000)).toEqual([]);
  });

  it('an input losing its picture and getting it back', async () => {
    const s = await base();
    const list = [t('lost', { type: 'inputLost', sourceId: 'cam' }), t('back', { type: 'inputBack', sourceId: 'cam' })];
    const a = demoApply(s, { type: 'setTriggers', triggers: list }, 0);
    const b = demoApply(a, { type: 'setNoSignal', ids: ['cam'] }, 10);
    expect(triggersDue(a, b, 10)).toEqual([0]);
    expect(triggersDue(b, b, 20)).toEqual([]);
    const c = demoApply(b, { type: 'setNoSignal', ids: [] }, 30);
    expect(triggersDue(b, c, 30)).toEqual([1]);
  });

  it('keeps numbers in range and leaves watched kinds to the control window', async () => {
    let s = await base();
    s = demoApply(
      s,
      {
        type: 'setTriggers',
        triggers: [
          t('x', { type: 'sound', sourceId: 'cam', above: true, db: -99, holdMs: 99_999_999 }),
          t('y', { type: 'videoTimeLeft', sourceId: 'vid', seconds: 0 }),
        ],
      },
      0,
    );
    expect(s.triggers[0]!.when).toMatchObject({ db: -60, holdMs: 600_000 });
    expect(s.triggers[1]!.when).toMatchObject({ seconds: 1 });
    expect(triggersDue(s, s, 1000)).toEqual([]);
  });
});
