import { describe, expect, it, vi } from 'vitest';
import {
  automaticLineup,
  BACK_STEADY_MS,
  cleanBackup,
  defaultBackup,
  Failover,
  lineupOf,
  MANUAL_GRACE_MS,
  nextInLineup,
  RECENT_FAIL_MS,
  SWITCH_GAP_MS,
} from './backup';
import { emptyShow } from './client';
import { InputHealth, watchFrames } from './inputHealth';
import type { Backup } from './types/Backup';
import type { Show } from './types/Show';
import type { NewSource } from './types/NewSource';
import { demoApply } from './demo';

const add = (s: Show, id: string, name: string, kind: NewSource['kind']) => demoApply(s, { type: 'addSource', source: { id, name, kind } }, 0);

/** Camera 1, Camera 2, a wide shot, a video and the logo picture; Camera 1 on air. */
function makeShow(backup: Partial<Backup> = {}): Show {
  let s = emptyShow();
  s.event.logo = 'logo.png';
  s = add(s, 'cam1', 'Camera 1', { type: 'camera', deviceId: 'd1', label: 'USB 1' });
  s = add(s, 'cam2', 'Camera 2', { type: 'camera', deviceId: 'd2', label: 'USB 2' });
  s = add(s, 'wide', 'Wide shot', { type: 'camera', deviceId: 'd3', label: 'USB 3' });
  s = add(s, 'clip', 'Clip', { type: 'color', color: '#123456' });
  s = add(s, 'logo', 'Logo', { type: 'image', path: 'logo.png' });
  s.event.backup = { ...defaultBackup(), ...backup };
  s.screens.live.program = 'cam1';
  s.screens.live.preview = 'cam2';
  return s;
}

/** Apply what the failover asked for (cuts and fades both put the input on air). */
function run(f: Failover, s: Show, down: string[], now: number) {
  const r = f.step(s, new Set(down), now);
  for (const a of r.actions) if (a.type === 'cutTo' || a.type === 'playNow') s.screens[a.screen].program = a.sourceId;
  return r;
}

describe('the lineup', () => {
  it('is automatic by default: the cameras in input order, then the logo', () => {
    const s = makeShow();
    expect(automaticLineup(s)).toEqual(['cam1', 'cam2', 'wide', 'logo']);
    expect(lineupOf(s)).toEqual(['cam1', 'cam2', 'wide', 'logo']);
  });

  it('uses the operator’s own order, without inputs that are gone', () => {
    const s = makeShow({ lineup: ['wide', 'gone', 'cam1', 'logo'] });
    expect(lineupOf(s)).toEqual(['wide', 'cam1', 'logo']);
  });

  it('is cleaned like the engine does', () => {
    expect(cleanBackup({ ...defaultBackup(), lineup: ['a', 'a', ' ', 'b'], lostAfterMs: 1, fadeMs: 9999, screens: ['live', 'live'] })).toEqual({
      ...defaultBackup(),
      lineup: ['a', 'b'],
      lostAfterMs: 500,
      fadeMs: 2000,
      screens: ['live'],
    });
  });

  it('goes to the next input after the lost one, skipping inputs that are down', () => {
    const s = makeShow();
    expect(nextInLineup(s, 'live', 'cam1', new Set(['cam1']), new Map(), 0)).toBe('cam2');
    expect(nextInLineup(s, 'live', 'cam1', new Set(['cam1', 'cam2']), new Map(), 0)).toBe('wide');
    expect(nextInLineup(s, 'live', 'wide', new Set(['wide']), new Map(), 0)).toBe('logo');
    // From the end it goes around to the start.
    expect(nextInLineup(s, 'live', 'logo', new Set(['logo']), new Map(), 0)).toBe('cam1');
    // Something not in the lineup (a color) is followed by the top of the lineup.
    expect(nextInLineup(s, 'live', 'clip', new Set(['clip']), new Map(), 0)).toBe('cam1');
  });

  it('never switches to an input that lost its picture moments ago', () => {
    const s = makeShow();
    const wentDown = new Map([['cam2', 1000]]);
    expect(nextInLineup(s, 'live', 'cam1', new Set(['cam1']), wentDown, 1000 + RECENT_FAIL_MS - 1)).toBe('wide');
    expect(nextInLineup(s, 'live', 'cam1', new Set(['cam1']), wentDown, 1000 + RECENT_FAIL_MS)).toBe('cam2');
  });

  it('skips inputs that are not in that screen’s list', () => {
    const s = makeShow();
    s.sources[1]!.screens = ['back'];
    expect(nextInLineup(s, 'live', 'cam1', new Set(['cam1']), new Map(), 0)).toBe('wide');
  });
});

describe('failover', () => {
  it('cuts to the next camera when the one on air goes out, and says so', () => {
    const s = makeShow();
    const f = new Failover();
    run(f, s, [], 0);
    const r = run(f, s, ['cam1'], 10_000);
    expect(r.actions).toEqual([{ type: 'cutTo', screen: 'live', sourceId: 'cam2' }]);
    expect(r.notices).toEqual([{ kind: 'switched', screen: 'live', from: 'cam1', to: 'cam2', at: 10_000 }]);
    expect(s.screens.live.program).toBe('cam2');
  });

  it('uses a quick fade when asked', () => {
    const s = makeShow({ fadeMs: 300 });
    const f = new Failover();
    run(f, s, [], 0);
    expect(run(f, s, ['cam1'], 10_000).actions).toEqual([{ type: 'playNow', screen: 'live', sourceId: 'cam2', transition: { kind: 'fade', durationMs: 300 } }]);
  });

  it('does nothing when it is off', () => {
    const s = makeShow({ on: false });
    const f = new Failover();
    run(f, s, [], 0);
    expect(run(f, s, ['cam1'], 10_000).actions).toEqual([]);
  });

  it('leaves the logo showing when everything is down, and says so once', () => {
    const s = makeShow({ lineup: ['cam1', 'cam2', 'wide'] });
    const f = new Failover();
    run(f, s, [], 0);
    const r = run(f, s, ['cam1', 'cam2', 'wide'], 10_000);
    expect(r.actions).toEqual([]);
    expect(r.notices).toEqual([{ kind: 'allDown', screen: 'live', from: 'cam1', to: null, at: 10_000 }]);
    expect(run(f, s, ['cam1', 'cam2', 'wide'], 10_250).notices).toEqual([]);
    // One comes back (and has been back long enough to trust): it goes on air.
    run(f, s, ['cam1', 'cam2'], 11_000);
    const back = run(f, s, ['cam1', 'cam2'], 10_000 + RECENT_FAIL_MS + 1);
    expect(back.actions).toEqual([{ type: 'cutTo', screen: 'live', sourceId: 'wide' }]);
  });

  it('never overrules a take the operator just made', () => {
    const s = makeShow();
    const f = new Failover();
    run(f, s, [], 0);
    // The operator takes Camera 2 by hand, and it is down.
    s.screens.live.program = 'cam2';
    const r = run(f, s, ['cam2'], 10_000);
    expect(r.actions).toEqual([]);
    expect(run(f, s, ['cam2'], 10_000 + MANUAL_GRACE_MS - 1).actions).toEqual([]);
    // Still down after the moment has passed: now it switches.
    expect(run(f, s, ['cam2'], 10_000 + MANUAL_GRACE_MS).actions).toEqual([{ type: 'cutTo', screen: 'live', sourceId: 'wide' }]);
  });

  it('a take told directly also wins', () => {
    const s = makeShow();
    const f = new Failover();
    run(f, s, [], 0);
    f.manualTake('live', 9_000);
    expect(run(f, s, ['cam1'], 10_000).actions).toEqual([]);
  });

  it('does not switch again straight away (no switching back and forth)', () => {
    const s = makeShow();
    const f = new Failover();
    run(f, s, [], 0);
    run(f, s, ['cam1'], 10_000);
    expect(s.screens.live.program).toBe('cam2');
    // Camera 2 goes out at once too: it waits for the gap before the next switch.
    expect(run(f, s, ['cam1', 'cam2'], 10_000 + SWITCH_GAP_MS - 1).actions).toEqual([]);
    expect(run(f, s, ['cam1', 'cam2'], 10_000 + SWITCH_GAP_MS).actions).toEqual([{ type: 'cutTo', screen: 'live', sourceId: 'wide' }]);
  });

  it('does not count its own switch as the operator’s take', () => {
    const s = makeShow();
    const f = new Failover();
    run(f, s, [], 0);
    run(f, s, ['cam1'], 10_000);
    // Camera 2 is lost after the gap: it switches on (no grace for a take that was its own).
    expect(run(f, s, ['cam1', 'cam2'], 12_500).actions).toEqual([{ type: 'cutTo', screen: 'live', sourceId: 'wide' }]);
  });

  it('when a lost camera comes back, it tells the operator and does not switch back by itself', () => {
    const s = makeShow();
    const f = new Failover();
    run(f, s, [], 0);
    run(f, s, ['cam1'], 10_000);
    run(f, s, [], 20_000);
    expect(run(f, s, [], 20_000 + BACK_STEADY_MS - 1).notices).toEqual([]);
    const r = run(f, s, [], 20_000 + BACK_STEADY_MS);
    expect(r.actions).toEqual([]);
    expect(r.notices).toEqual([{ kind: 'back', screen: 'live', from: 'cam1', to: 'cam2', at: 20_000 + BACK_STEADY_MS }]);
    expect(s.screens.live.program).toBe('cam2');
    // Said once.
    expect(run(f, s, [], 30_000).notices).toEqual([]);
  });

  it('switches back by itself when that is chosen, unless the operator took something since', () => {
    const s = makeShow({ switchBack: true });
    const f = new Failover();
    run(f, s, [], 0);
    run(f, s, ['cam1'], 10_000);
    run(f, s, [], 20_000);
    const r = run(f, s, [], 20_000 + BACK_STEADY_MS);
    expect(r.actions).toEqual([{ type: 'cutTo', screen: 'live', sourceId: 'cam1' }]);
    expect(r.notices[0]?.kind).toBe('switchedBack');

    const t = makeShow({ switchBack: true });
    const g = new Failover();
    run(g, t, [], 0);
    run(g, t, ['cam1'], 10_000);
    t.screens.live.program = 'wide'; // the operator's own choice
    run(g, t, ['cam1'], 15_000);
    run(g, t, [], 20_000);
    const r2 = run(g, t, [], 20_000 + BACK_STEADY_MS);
    expect(r2.actions).toEqual([]);
    expect(r2.notices[0]?.kind).toBe('back');
  });

  it('leaves the Back Screen alone while it follows Live, and looks after it when it does not', () => {
    const s = makeShow();
    s.backFollowsLive = true;
    s.screens.back.program = 'cam1';
    const f = new Failover();
    run(f, s, [], 0);
    expect(run(f, s, ['cam1'], 10_000).actions.map((a) => a.type === 'cutTo' && a.screen)).toEqual(['live']);
    const t = makeShow();
    t.screens.back.program = 'wide';
    const g = new Failover();
    run(g, t, [], 0);
    expect(run(g, t, ['wide'], 10_000).actions).toEqual([{ type: 'cutTo', screen: 'back', sourceId: 'logo' }]);
  });

  it('does nothing during PANIC', () => {
    const s = makeShow();
    s.panic = true;
    const f = new Failover();
    run(f, s, [], 0);
    expect(run(f, s, ['cam1'], 10_000).actions).toEqual([]);
  });
});

describe('input health', () => {
  it('a camera whose frames stop counts as lost after the chosen time', () => {
    let now = 0;
    const h = new InputHealth(() => now);
    const stop = h.watch('cam1');
    h.frame('cam1');
    now = 1400;
    h.beat();
    expect(h.down('cam1', 1500)).toBeNull();
    now = 1600;
    h.beat();
    expect(h.down('cam1', 1500)).toBe('No picture coming in');
    h.frame('cam1');
    expect(h.down('cam1', 1500)).toBeNull();
    stop();
    now = 9000;
    h.beat();
    expect(h.down('cam1', 1500)).toBeNull();
  });

  it('gives a camera that is opening time for its first frame', () => {
    let now = 0;
    const h = new InputHealth(() => now);
    h.watch('cam1');
    now = 3000;
    h.beat();
    expect(h.down('cam1', 1500)).toBeNull();
    now = 5100;
    h.beat();
    expect(h.down('cam1', 1500)).not.toBeNull();
  });

  it('says nothing about stopped frames while the window itself is not drawing', () => {
    let now = 0;
    const h = new InputHealth(() => now);
    h.watch('cam1');
    h.frame('cam1');
    now = 10_000;
    expect(h.down('cam1', 1500)).toBeNull();
  });

  it('a failure holds until every view that saw it says it is over', () => {
    const h = new InputHealth(() => 0);
    const a = Symbol('a');
    const b = Symbol('b');
    h.report('cam1', a, 'Camera not found or unplugged');
    h.report('cam1', b, 'Camera not found or unplugged');
    h.report('cam1', a, null);
    expect(h.down('cam1', 1500)).toBe('Camera not found or unplugged');
    h.report('cam1', b, null);
    expect(h.down('cam1', 1500)).toBeNull();
  });

  it('a pretend loss lasts as long as asked', () => {
    let now = 0;
    const h = new InputHealth(() => now);
    h.simulate('cam1', 6000);
    expect(h.down('cam1', 1500)).toBe('No signal (test)');
    now = 6001;
    expect(h.down('cam1', 1500)).toBeNull();
  });

  it('a stream’s own status counts', () => {
    const h = new InputHealth(() => 0);
    h.setFailed('srt', 'The stream isn’t coming in');
    expect(h.downAll(['srt', 'cam1'], 1500)).toEqual(new Map([['srt', 'The stream isn’t coming in']]));
    h.setFailed('srt', null);
    expect(h.downAll(['srt'], 1500).size).toBe(0);
  });

  it('counts the frames a video element shows, and stops counting when told', () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const h = new InputHealth(() => now);
      let cb: (() => void) | null = null;
      const video = {
        requestVideoFrameCallback: (f: () => void) => ((cb = f), 1),
        cancelVideoFrameCallback: () => (cb = null),
        closest: () => null,
        style: { opacity: '' },
        srcObject: null,
      } as unknown as HTMLVideoElement;
      const stop = watchFrames('cam1', video, h, 100);
      cb!();
      now = 1000;
      h.beat();
      cb!();
      expect(h.down('cam1', 1500)).toBeNull();
      now = 3000;
      h.beat();
      vi.advanceTimersByTime(200);
      expect(h.down('cam1', 1500)).toBe('No picture coming in');
      stop();
      expect(cb).toBeNull();
      expect(h.down('cam1', 1500)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never calls a picture drawn some other way (green screen) lost', () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const h = new InputHealth(() => now);
      const video = {
        requestVideoFrameCallback: () => 1,
        cancelVideoFrameCallback: () => {},
        closest: (sel: string) => (sel === '.keyed' ? {} : null),
        style: { opacity: '0' },
        srcObject: null,
      } as unknown as HTMLVideoElement;
      watchFrames('cam1', video, h, 100);
      for (let t = 0; t < 20; t++) {
        now += 500;
        h.beat();
        vi.advanceTimersByTime(500);
        expect(h.down('cam1', 1500)).toBeNull();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
