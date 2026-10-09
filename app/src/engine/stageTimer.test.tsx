import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MonitorScreen } from '../components/MonitorScreen';
import { defaultCountdown, emptyShow } from './client';
import { overText, stageTimer } from './stageTimer';
import type { Countdown } from './types/Countdown';
import type { Show } from './types/Show';

const m = { wrapUpS: 120, overtime: true, progress: true };
// A 10-minute countdown started at 0 (ends at 600 000).
const running = (): Countdown => ({ ...defaultCountdown(), lengthMs: 600_000, remainingMs: 600_000, endsAt: 600_000 });

describe('the speaker timer on the Monitor', () => {
  it('turns amber to wrap up, red in the last minute, and counts the time over', () => {
    const c = running();
    expect(stageTimer(c, m, 0)).toEqual({ tone: 'normal', text: '10:00', gone: 0 });
    expect(stageTimer(c, m, 300_000)).toMatchObject({ tone: 'normal', gone: 0.5 });
    expect(stageTimer(c, m, 480_000)).toMatchObject({ tone: 'wrapUp', text: '2:00' });
    expect(stageTimer(c, m, 545_000)).toMatchObject({ tone: 'urgent', text: '0:55' });
    expect(stageTimer(c, m, 600_400)).toMatchObject({ tone: 'urgent', text: '0:00', gone: 1 });
    expect(stageTimer(c, m, 665_000)).toMatchObject({ tone: 'over', text: '+1:05' });
  });

  it('follows the Monitor settings: no amber, no time over, no bar', () => {
    const c = running();
    const off = { wrapUpS: 0, overtime: false, progress: false };
    expect(stageTimer(c, off, 480_000)).toEqual({ tone: 'normal', text: '2:00', gone: null });
    expect(stageTimer(c, off, 700_000)).toMatchObject({ tone: 'urgent', text: '0:00' });
    expect(stageTimer({ ...c, atZero: { type: 'showText' }, endText: 'Thank you' }, m, 700_000)).toMatchObject({ text: 'Thank you' });
    expect(stageTimer({ ...c, endsAt: null, remainingMs: 90_000 }, m, 0)).toMatchObject({ tone: 'paused', text: '1:30' });
    expect(overText(3_725_000)).toBe('+1:02:05');
  });

  it('shows on the Monitor with its color and bar', () => {
    const show: Show = emptyShow();
    show.sources = [{ id: 'cd', name: 'Talk', kind: { type: 'countdown', background: '#000', timer: { ...running(), endsAt: Date.now() - 30_000 } } } as never];
    const { container } = render(<MonitorScreen show={show} />);
    expect(screen.getByText('OVERTIME')).toBeInTheDocument();
    expect(screen.getByText('+0:30')).toBeInTheDocument();
    expect(container.querySelector('[data-tone="over"] .mscreen__bar i')).not.toBeNull();
  });
});
