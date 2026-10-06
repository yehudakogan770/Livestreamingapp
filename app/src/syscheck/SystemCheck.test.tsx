import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { judge, type BrowserFacts, type Facts } from './rules';

const opened: unknown[] = [];
vi.mock('../reports/ReportUI', () => ({ openProblemReport: (t: unknown) => void opened.push(t) }));

const { SystemCheckDialog } = await import('./SystemCheck');

const facts: Facts = {
  os: { name: 'Windows 10 Home', build: 19045, displayVersion: '22H2', is64bit: true },
  cpu: { name: 'Intel(R) Core(TM) i5-7200U', cores: 2, threads: 4 },
  memory: { totalMb: 7898, availableMb: 2500 },
  gpus: [{ name: 'Intel(R) UHD Graphics 620', vendor: 'intel', vramMb: 128, driverVersion: '26.20', driverDate: '2019-08-01', software: false }],
  disks: [{ purpose: 'recordings', drive: 'C:', freeMb: 18 * 1024, totalMb: 256 * 1024, kind: 'ssd' }],
  webview2: '131.0.2903.70',
  ffmpeg: { found: true, runs: true, version: '7.1' },
  hwEncoders: [],
  hwDecode: null,
  power: { battery: true, onBattery: true, plan: 'balanced', mode: '' },
  displays: [{ width: 1366, height: 768, scale: 1, primary: true }],
  native: null,
  missing: [],
};
const browser: BrowserFacts = { webgl2: true, renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620)', cameras: 1, mics: 1, edge: 131, today: '2026-10-06' };

describe('the Check this computer window', () => {
  it('shows the verdict, the first advice lines, everything on Show all, and sends only through Report a problem', () => {
    const report = judge('lumora', facts, browser, { videoKbps: 6000, audioKbps: 160, iso: true, cameras: 1 });
    const close = vi.fn();
    render(<SystemCheckDialog app="lumora" first={{ report, facts, browser, version: '1.0.0' }} onClose={close} />);
    expect(screen.getByRole('heading', { name: 'Risky — works, but follow the advice below' })).toBeInTheDocument();
    const tips = () => document.querySelectorAll('.sc-tip');
    expect(tips()).toHaveLength(5);
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show all/ }));
    expect(tips()).toHaveLength(report.tips.length);
    expect(within(screen.getByRole('table')).getByText('Background removal')).toBeInTheDocument();
    expect(screen.getByText('Less than 20 GB free on C: — recordings may stop.')).toBeInTheDocument();
    expect(opened).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Send to the Lumora team/ }));
    expect(close).toHaveBeenCalled();
    expect(String(opened[0])).toContain('System check: RISKY');
  });
});
