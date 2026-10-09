// Audio cues of a Titler graphic on air: when each sound starts on the sound
// clock (within a frame of its marker), which mixes it goes to, and that
// taking the graphic off, Blank and PANIC are respected.

import { describe, expect, it } from 'vitest';
import { demoApply } from '../engine/demo';
import { emptyShow } from '../engine/client';
import { overlayActions } from '../engine/overlays';
import type { Show } from '../engine/types/Show';
import { fromTemplate, starterTemplates } from '../../../titler/src/core/templates';
import { titlerKind } from './titlerSource';
import { cueBusLevel, dueCues, TitlerCuePlayer, type CueAudio } from './titlerCues';
import type { Mix } from '../engine/audio';

const FRAME = 1000 / 30;

function withCues(): { show: Show; id: string } {
  const p = fromTemplate(starterTemplates().find((t) => t.name === 'Name and role')!);
  const c = p.compositions.find((x) => x.id === p.main)!;
  p.assets.push({ id: 'ding', name: 'Ding', kind: 'audio', src: 'data:audio/wav;base64,AAAA' });
  // IN at 0.1 s (Stream), HOLD at 1.0 s (Hall and Recording), OUT 0.2 s after it starts.
  c.cues = [
    { id: 'a', t: 0.1, name: 'In', sound: 'ding' },
    { id: 'b', t: Math.min(c.markers.outStart - 0.1, c.markers.inEnd + 0.4), name: 'Hold', sound: 'ding', mixes: ['hall', 'recording'] },
    { id: 'c', t: c.markers.outStart + 0.2, name: 'Out', sound: 'ding', gain: -6 },
  ];
  let s = emptyShow();
  s = demoApply(s, { type: 'addSource', source: { id: 'lt', name: 'Lower third', kind: titlerKind(p) } }, 0);
  return { show: s, id: 'lt' };
}

/** A sound clock that only records what was asked of it. */
class FakeAudio implements CueAudio {
  currentTime = 50;
  started: { when: number; offset: number; stopped: boolean; to: string[]; gain: number }[] = [];
  createGain(): GainNode {
    const g = {
      gain: { value: 1, setTargetAtTime(v: number) {
        g.gain.value = v;
      } },
      name: '',
      connect: (n: { name?: string }) => (g.to.push(n.name ?? ''), n),
      disconnect: () => {},
      to: [] as string[],
    };
    return g as unknown as GainNode;
  }
  createBufferSource(): AudioBufferSourceNode {
    const rec = { when: 0, offset: 0, stopped: false, to: [] as string[], gain: 1 };
    const n = {
      buffer: null,
      connect: (g: { to: string[]; gain: { value: number } }) => {
        rec.to = g.to;
        Object.defineProperty(rec, 'gain', { get: () => g.gain.value });
        return g;
      },
      disconnect: () => {},
      start: (when: number, offset: number) => {
        rec.when = when;
        rec.offset = offset;
        this.started.push(rec);
      },
      stop: () => (rec.stopped = true),
    };
    return n as unknown as AudioBufferSourceNode;
  }
  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve({ duration: 0.5 } as AudioBuffer);
  }
}

function player() {
  const ctx = new FakeAudio();
  const into = Object.fromEntries((['master', 'a', 'b'] as Mix[]).map((m) => [m, { name: m }])) as unknown as Record<Mix, AudioNode>;
  const p = new TitlerCuePlayer(ctx, into, () => Promise.resolve(new ArrayBuffer(4)));
  // The buses connect into the mixes by name.
  for (const m of ['master', 'a', 'b'] as Mix[]) (p.buses[m] as unknown as { name: string }).name = m;
  return { ctx, p };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Titler audio cues in Lumora', () => {
  it('are due at their markers from the take and from taking off', () => {
    let { show, id } = withCues();
    const t0 = 1_000_000;
    for (const a of overlayActions(show, id, 'live', true)) show = demoApply(show, a, t0);
    const memo = new Map<string, number>();
    const on = dueCues(show, t0, t0 + 60_000, memo);
    expect(on.map((d) => d.at - t0)).toEqual([100, expect.any(Number)]);
    expect(on[0]!.mixes).toEqual(['master']);
    expect(on[1]!.mixes).toEqual(['a', 'b']);
    const ch = show.overlays.findIndex((o) => o.sourceId === id);
    const t1 = t0 + 5000;
    show = demoApply(show, { type: 'setOverlayOn', channel: ch, value: false }, t1);
    const off = dueCues(show, t1, t1 + 5000, memo);
    expect(off.map((d) => Math.round(d.at - t1))).toEqual([200]);
    expect(off[0]!.gain).toBeCloseTo(0.5, 1);
  });

  it('start on the sound clock within a frame of their place, scheduled ahead', async () => {
    let { show, id } = withCues();
    const { ctx, p } = player();
    const t0 = 2_000_000;
    for (const a of overlayActions(show, id, 'live', true)) show = demoApply(show, a, t0);
    p.tick(show, t0); // starts loading the sound
    await flush();
    // The engine ticks every 33 ms; the sound clock moves with the wall clock.
    for (let now = t0; now < t0 + 2000; now += 33) {
      ctx.currentTime = 50 + (now - t0) / 1000;
      p.tick(show, now);
    }
    const first = ctx.started[0]!;
    expect(Math.abs((first.when - 50) * 1000 - 100)).toBeLessThan(FRAME);
    expect(first.to).toEqual(['master']);
    const hold = ctx.started[1]!;
    expect(hold.to).toEqual(['a', 'b']);
    // Each once, never twice.
    expect(ctx.started.length).toBe(2);
  });

  it('a cue scheduled ahead is called back when the graphic is taken off first; PANIC stops everything', async () => {
    let { show, id } = withCues();
    const { ctx, p } = player();
    const t0 = 3_000_000;
    for (const a of overlayActions(show, id, 'live', true)) show = demoApply(show, a, t0);
    p.tick(show, t0);
    await flush();
    ctx.currentTime = 50;
    p.tick(show, t0); // the IN cue (at +100 ms) is scheduled ahead
    expect(ctx.started.length).toBe(1);
    const ch = show.overlays.findIndex((o) => o.sourceId === id);
    show = demoApply(show, { type: 'setOverlayOn', channel: ch, value: false }, t0 + 20);
    ctx.currentTime = 50.02;
    p.tick(show, t0 + 20);
    expect(ctx.started[0]!.stopped).toBe(true);
    // The OUT cue plays 200 ms after taking off; PANIC stops it.
    for (let now = t0 + 20; now < t0 + 300; now += 33) {
      ctx.currentTime = 50 + (now - t0) / 1000;
      p.tick(show, now);
    }
    const out = ctx.started[1]!;
    expect(Math.abs((out.when - 50) * 1000 - 220)).toBeLessThan(FRAME);
    show = demoApply(show, { type: 'panic', value: true } as never, t0 + 300);
    p.tick(show, t0 + 300);
    expect(out.stopped).toBe(true);
    expect(dueCues(show, t0, t0 + 10_000, new Map())).toEqual([]);
  });

  it('the cue buses follow the mixes and go down with Blank and PANIC', () => {
    const { show } = withCues();
    expect(cueBusLevel(show, 'master', 100_000)).toBeGreaterThan(0);
    const blank = { ...show, screens: { ...show.screens, live: { ...show.screens.live, blank: true, blankChangedAt: 0 } } };
    expect(cueBusLevel(blank, 'master', 10_000)).toBe(0);
    const muted = { ...show, audio: { ...show.audio, a: { ...show.audio.a, muted: true } } };
    expect(cueBusLevel(muted, 'a', 100_000)).toBe(0);
    const panic = { ...show, panic: true, panicChangedAt: 0 };
    expect(cueBusLevel(panic, 'b', 10_000)).toBe(0);
  });
});
