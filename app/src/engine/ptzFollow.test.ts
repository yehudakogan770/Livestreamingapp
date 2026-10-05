import { describe, expect, it } from 'vitest';
import { commandsFor, ptzPlan, STILL } from './ptzFollow';

const af = { who: 'main' as const, tightness: 0.5, speed: 0.5 };

describe('PTZ follow', () => {
  it('stays still when the person is already framed', () => {
    const p = ptzPlan([{ x: 0.42, y: 0.15, w: 0.16, h: 0.7 }], af);
    expect(p.pan).toBe(0);
    expect(p.tilt).toBe(0);
  });
  it('turns toward someone off to the side', () => {
    expect(ptzPlan([{ x: 0.8, y: 0.2, w: 0.1, h: 0.6 }], af).pan).toBe(1);
    expect(ptzPlan([{ x: 0.05, y: 0.2, w: 0.1, h: 0.6 }], af).pan).toBe(-1);
  });
  it('zooms in on someone small, and out when they fill the picture', () => {
    expect(ptzPlan([{ x: 0.47, y: 0.4, w: 0.06, h: 0.2 }], af).zoom).toBe(1);
    expect(ptzPlan([{ x: 0.05, y: 0, w: 0.9, h: 1 }], af).zoom).toBe(-1);
  });
  it('does nothing when nobody is there', () => {
    expect(ptzPlan([], af)).toEqual(STILL);
  });
  it('sends commands only when something changes, and always stops', () => {
    const go = { pan: 1, tilt: 0, speed: 0.5, zoom: 0 as const, zoomSpeed: 0 };
    expect(commandsFor(STILL, go)).toEqual([{ type: 'move', pan: 1, tilt: 0, speed: 0.5 }]);
    expect(commandsFor(go, go)).toEqual([]);
    expect(commandsFor(go, STILL)).toEqual([{ type: 'stop' }]);
  });
});
